// apps/server/src/services/rag.service.ts
import crypto from 'crypto';
import mongoose from 'mongoose';
import { CodeCitation } from '@codelens/shared';
import { CodeChunkModel, ICodeChunk } from '../models/codeChunk.model';
import { RepositoryModel } from '../models/repository.model';
import { redisConnection } from '../config/redis';
import { GeminiService } from './gemini.service';

/**
 * Tính toán Cosine Similarity giữa 2 vector số thực
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface StreamChatOptions {
  repoId: string;
  question: string;
  selectedFile?: string | null;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
  onToken: (token: string) => void;
  onCitations?: (citations: CodeCitation[]) => void;
}

export class RagService {
  /**
   * Tạo Redis Cache Key từ repoId, question và selectedFile
   */
  private static getCacheKey(repoId: string, question: string, selectedFile?: string | null): string {
    const raw = `${question.trim().toLowerCase()}::${selectedFile || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    return `rag:cache:${repoId}:${hash}`;
  }

  /**
   * 1. Vector Search: Truy vấn Top Code Chunks tương đồng ngữ nghĩa nhất
   * ÁP DỤNG BỘ LỌC CHẶT CHẼ (PRE-FILTERING) THEO repoId:
   * - Mọi truy vấn Atlas $vectorSearch BẮT BUỘC lọc theo repoId: { $eq: repoObjectId }
   * - Có thêm tầng $match: { repoId: repoObjectId } bảo vệ 2 lớp ngăn chặn rò rỉ chunk khác repo
   * - Thuật toán Fallback tính Cosine Similarity in-memory cũng chỉ quét các chunks thuộc đúng repoId này
   */
  static async searchVectorChunks(
    repoId: string,
    questionVector: number[],
    limit = 5,
    selectedFile?: string | null
  ): Promise<ICodeChunk[]> {
    if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
      console.warn(`⚠️ [RagService.searchVectorChunks] repoId không hợp lệ: "${repoId}". Hủy truy vấn.`);
      return [];
    }

    const repoObjectId = new mongoose.Types.ObjectId(repoId);

    try {
      // ── Atlas Vector Search Pipeline với Pre-filter và Post-match ──
      const aggregationPipeline: any[] = [
        {
          $vectorSearch: {
            index: 'vector_code_index',
            path: 'embedding',
            queryVector: questionVector,
            numCandidates: 100,
            limit: limit * 2,
            filter: {
              repoId: { $eq: repoObjectId },
            },
          },
        },
        // BẢO VỆ 2 LỚP: Tuyệt đối ngăn chặn rò rỉ dữ liệu từ repository khác
        {
          $match: {
            repoId: repoObjectId,
          },
        },
        {
          $project: {
            repoId: 1,
            filePath: 1,
            symbolName: 1,
            symbolType: 1,
            startLine: 1,
            endLine: 1,
            content: 1,
            dependencies: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const results = await CodeChunkModel.aggregate(aggregationPipeline);

      if (results && results.length > 0) {
        // Đảm bảo 100% chunks trả về thuộc đúng repoId
        const verifiedResults = results.filter(
          (r) => r.repoId && (r.repoId.toString() === repoId || r.repoId.equals?.(repoObjectId))
        );
        if (verifiedResults.length > 0) {
          console.log(`🎯 [Atlas Vector Search] Tìm thấy ${verifiedResults.length} chunks cho repo "${repoId}".`);
          return verifiedResults.slice(0, limit) as unknown as ICodeChunk[];
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ [RagService.searchVectorChunks] Atlas $vectorSearch không khả dụng (${err.message}). Kích hoạt Fallback In-Memory.`);
    }

    // ── Fallback In-Memory: Tìm trong MongoDB theo repoId và tính Cosine Similarity ──
    try {
      // BẮT BUỘC: Chỉ tải các code chunk thuộc đúng repoId từ cơ sở dữ liệu
      const allChunks = await CodeChunkModel.find({
        $or: [
          { repoId: repoObjectId },
          { repoId: repoId },
        ],
      }).lean();

      if (!allChunks || allChunks.length === 0) {
        console.warn(`⚠️ [RagService.searchVectorChunks Fallback] Không tìm thấy chunk nào trong DB cho repo: ${repoId}`);
        return [];
      }

      // Bộ lọc an toàn: Kiểm tra chặt chẽ repoId trên bộ nhớ RAM
      const strictlyRepoChunks = allChunks.filter(
        (chunk) => chunk.repoId && (chunk.repoId.toString() === repoId || (chunk.repoId as any).equals?.(repoObjectId))
      );

      if (strictlyRepoChunks.length === 0) {
        return [];
      }

      const scoredChunks = strictlyRepoChunks.map((chunk) => {
        let score = 0;
        if (chunk.embedding && chunk.embedding.length > 0) {
          score = cosineSimilarity(questionVector, chunk.embedding);
        }
        // Thưởng điểm ưu tiên nếu chunk thuộc đúng file người dùng đang chọn trên canvas
        if (selectedFile && chunk.filePath === selectedFile) {
          score += 0.2;
        }
        return { chunk, score };
      });

      scoredChunks.sort((a, b) => b.score - a.score);
      const topScored = scoredChunks.slice(0, limit).map((s) => s.chunk as unknown as ICodeChunk);
      console.log(`🎯 [Fallback Cosine Search] Tìm thấy ${topScored.length}/${strictlyRepoChunks.length} chunks cho repo "${repoId}".`);
      return topScored;
    } catch (err: any) {
      console.error(`❌ [RagService.searchVectorChunks Fallback Error]:`, err);
      return [];
    }
  }

  /**
   * 2. Graph Expansion: Mở rộng ngữ cảnh từ Đồ thị Phụ thuộc (AST Dependencies & ArchitectureGraph)
   * Truy xuất thêm các module/hàm phụ thuộc mà Top Chunks đang import hoặc liên kết tới
   * ĐẢM BẢO CHỈ LẤY CHUNKS THUỘC ĐÚNG repoId HIỆN TẠI
   */
  static async expandContextWithGraph(
    repoId: string,
    initialChunks: ICodeChunk[],
    maxExpanded = 4
  ): Promise<ICodeChunk[]> {
    if (!initialChunks || initialChunks.length === 0) return [];
    if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) return initialChunks;

    const repoObjectId = new mongoose.Types.ObjectId(repoId);
    const existingChunkIds = new Set(initialChunks.map((c) => c._id?.toString() || `${c.filePath}:${c.symbolName}`));
    const initialFiles = new Set(initialChunks.map((c) => c.filePath));

    // Tập hợp tất cả các file/module phụ thuộc được trích xuất từ AST dependencies
    const targetFilePaths = new Set<string>();
    for (const chunk of initialChunks) {
      if (Array.isArray(chunk.dependencies)) {
        for (const dep of chunk.dependencies) {
          if (dep && !initialFiles.has(dep)) {
            targetFilePaths.add(dep);
          }
        }
      }
    }

    // Tra cứu thêm các cạnh (edges) trong architectureGraph của đúng Repository này
    try {
      const repoDoc = await RepositoryModel.findById(repoObjectId, 'architectureGraph').lean();
      if (repoDoc?.architectureGraph?.edges) {
        for (const edge of repoDoc.architectureGraph.edges) {
          if (initialFiles.has(edge.source) && !initialFiles.has(edge.target)) {
            targetFilePaths.add(edge.target);
          }
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ [RagService.expandContextWithGraph] Đọc architectureGraph thất bại: ${err.message}`);
    }

    if (targetFilePaths.size === 0) {
      return initialChunks;
    }

    // Truy vấn thêm các code chunk quan trọng thuộc các file phụ thuộc này (GIỚI HẠN CHẶT TRONG ĐÚNG repoId)
    try {
      const relatedChunks = await CodeChunkModel.find({
        $or: [{ repoId: repoObjectId }, { repoId: repoId }],
        filePath: { $in: Array.from(targetFilePaths) },
      })
        .limit(maxExpanded * 2)
        .lean();

      const expandedChunks: ICodeChunk[] = [];
      for (const chunk of relatedChunks) {
        // Kiểm tra độc quyền repoId
        const isSameRepo = chunk.repoId && (chunk.repoId.toString() === repoId || (chunk.repoId as any).equals?.(repoObjectId));
        if (!isSameRepo) continue;

        const idKey = chunk._id?.toString() || `${chunk.filePath}:${chunk.symbolName}`;
        if (!existingChunkIds.has(idKey)) {
          existingChunkIds.add(idKey);
          expandedChunks.push(chunk as unknown as ICodeChunk);
          if (expandedChunks.length >= maxExpanded) break;
        }
      }

      console.log(`🔗 [Graph Expansion] Đã bổ sung ${expandedChunks.length} chunks liên kết cho repo ${repoId}.`);
      return [...initialChunks, ...expandedChunks];
    } catch (err: any) {
      console.warn(`⚠️ [RagService.expandContextWithGraph] Query chunks phụ thuộc thất bại: ${err.message}`);
      return initialChunks;
    }
  }

  /**
   * 3. Xây dựng System Prompt Grounded chống ảo giác (Anti-Hallucination)
   * Định danh rõ ràng Repository hiện tại và cung cấp lịch sử ngữ cảnh
   */
  static buildGroundedPrompt(
    chunks: ICodeChunk[],
    userQuestion: string,
    repoInfo: { name: string; owner: string; repoUrl: string; summary?: string },
    conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>
  ): { prompt: string; citations: CodeCitation[] } {
    const citations: CodeCitation[] = chunks.map((c) => ({
      filePath: c.filePath,
      symbolName: c.symbolName,
      startLine: c.startLine,
      endLine: c.endLine,
    }));

    const formattedContextChunks = chunks
      .map(
        (c) =>
          `=== FILE: ${c.filePath} (Symbol: ${c.symbolName}, Loai: ${c.symbolType}, Dong: ${c.startLine}-${c.endLine}) ===\n${c.content}`
      )
      .join('\n\n');

    const prompt = `Bạn là Trợ lý AI Phân tích Kiến trúc Mã nguồn (Principal Software Architect) của CodeLens AI.
Bạn đang trực tiếp hỗ trợ phân tích kho lưu trữ (Repository):
- Tên Dự án / Repository: "${repoInfo.name}" (${repoInfo.owner}/${repoInfo.name})
- URL GitHub: ${repoInfo.repoUrl}
${repoInfo.summary ? `- Tóm tắt dự án: ${repoInfo.summary}` : ''}

LƯU Ý CỐT LÕI:
Tất cả các đoạn mã trong phần [NGỮ CẢNH MÃ NGUỒN] bên dưới CHÍNH LÀ mã nguồn của dự án "${repoInfo.name}".
Khi lập trình viên đặt câu hỏi (ví dụ: "chức năng favorite hoạt động thế nào", "luồng xác thực", hay hỏi "tôi đang hỏi về repo ${repoInfo.name}"), hãy hiểu rằng họ đang hỏi về các tính năng và kiến trúc của chính dự án "${repoInfo.name}" này! Hãy khẳng định và giải thích rõ ràng dựa trên các file mã nguồn của "${repoInfo.name}".

QUY TẮC BẮT BUỘC:
1. Dựa trên các đoạn mã được trích xuất trong [NGỮ CẢNH MÃ NGUỒN] của dự án "${repoInfo.name}" để giải thích rõ ràng, mạch lạc bằng tiếng Việt chuyên ngành.
2. Mọi logic code PHẢI kèm trích dẫn chính xác theo định dạng: \`[filePath:L<startLine>-L<endLine>]\` (Ví dụ: \`[backend/src/controllers/authController.ts:L30-L50]\`).
3. QUY TẮC VẼ SƠ ĐỒ MERMAID (CỰC KỲ QUAN TRỌNG):
   - Nếu câu hỏi yêu cầu hoặc liên quan đến luồng tương tác giữa các hàm/file, vẽ một sơ đồ tuần tự \`\`\`mermaid sequenceDiagram.
   - BẮT BUỘC viết cú pháp Mermaid hợp lệ 100%:
     * Mỗi dòng tương tác PHẢI có đầy đủ: ParticipantA->>ParticipantB: Nội dung tương tác.
     * TUYỆT ĐỐI KHÔNG để mũi tên trơ trọi ở cuối dòng (ví dụ KHÔNG viết "Client->>" rồi xuống dòng).
     * TUYỆT ĐỐI KHÔNG viết "Note over Participant," với dấu phẩy ở cuối.
     * Nếu nội dung tương tác có ký tự đặc biệt như ngoặc đơn (), ngoặc vuông [], dấu hai chấm :, hãy đặt toàn bộ nội dung sau dấu hai chấm trong dấu ngoặc kép hoặc diễn đạt bằng chữ đơn giản.
4. Trả lời súc tích, chuyên nghiệp, giải thích cấu trúc phân tầng và cách các hàm liên kết với nhau.
${
  conversationHistory && conversationHistory.length > 0
    ? `\n[LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ]:\n${conversationHistory
        .map((h) => `${h.role === 'user' ? 'Lập trình viên' : 'AI'}: ${h.text}`)
        .join('\n')}\n`
    : ''
}
[NGỮ CẢNH MÃ NGUỒN CỦA DỰ ÁN "${repoInfo.name}"]:
${formattedContextChunks || '(Không tìm thấy đoạn mã liên quan trực tiếp trong hệ thống)'}

[CÂU HỎI CỦA LẬP TRÌNH VIÊN]:
${userQuestion}`;

    return { prompt, citations };
  }

  /**
   * 4. Thực hiện toàn bộ Pipeline RAG & Stream câu trả lời kèm Semantic Caching
   * Luôn cô lập hoàn toàn câu hỏi và kết quả theo đúng repoId
   */
  static async streamChat(options: StreamChatOptions): Promise<void> {
    const { repoId, question, selectedFile, history, onToken, onCitations } = options;

    if (!question || !question.trim()) {
      onToken('Vui lòng nhập câu hỏi để bắt đầu phân tích mã nguồn.');
      return;
    }

    if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
      onToken('Lỗi: Repository ID không hợp lệ hoặc chưa được chọn.');
      return;
    }

    const repoObjectId = new mongoose.Types.ObjectId(repoId);

    // Lấy thông tin Metadata của Repository (Tên, Owner, Url, Summary)
    const repoDoc = await RepositoryModel.findById(repoObjectId).select('name owner repoUrl summary description').lean();
    const repoInfo = {
      name: repoDoc?.name || 'Repository',
      owner: repoDoc?.owner || '',
      repoUrl: repoDoc?.repoUrl || '',
      summary: repoDoc?.summary || repoDoc?.description || '',
    };

    const cacheKey = this.getCacheKey(repoId, question, selectedFile);

    // ── Bước 1: Kiểm tra Semantic Cache trong Redis (< 50ms) ──
    try {
      const cachedAnswer = await redisConnection.get(cacheKey);
      if (cachedAnswer) {
        console.log(`⚡ [Redis Cache Hit] Trả lời ngay từ cache [Repo: ${repoInfo.name}] cho câu hỏi: "${question}"`);
        const words = cachedAnswer.split(/(\s+)/);
        for (const word of words) {
          onToken(word);
        }
        return;
      }
    } catch (err: any) {
      console.warn(`⚠️ [Redis Cache Check Warning]: ${err.message}`);
    }

    // ── Bước 2: Tạo Vector Embedding cho câu hỏi ──
    console.log(`🔎 [RagService] Bắt đầu Hybrid Search [Repo: ${repoInfo.name} (${repoId})] cho câu hỏi: "${question}"`);
    const queryEmbedding = await GeminiService.createEmbedding(question);

    // ── Bước 3: Hybrid Vector Search (Strict repoId filtering) ──
    const vectorChunks = await this.searchVectorChunks(repoId, queryEmbedding, 5, selectedFile);

    // Bổ sung thêm chunk từ selectedFile nếu người dùng đang chủ động chọn file đó
    if (selectedFile) {
      const fileChunks = await CodeChunkModel.find({
        $or: [{ repoId: repoObjectId }, { repoId: repoId }],
        filePath: selectedFile,
      })
        .limit(3)
        .lean();

      for (const fc of fileChunks) {
        const isSameRepo = fc.repoId && (fc.repoId.toString() === repoId || (fc.repoId as any).equals?.(repoObjectId));
        if (isSameRepo && !vectorChunks.some((vc) => vc.filePath === fc.filePath && vc.symbolName === fc.symbolName)) {
          vectorChunks.push(fc as unknown as ICodeChunk);
        }
      }
    }

    // ── Bước 4: Graph Expansion (Lọc tuyệt đối theo repoId) ──
    const finalChunks = await this.expandContextWithGraph(repoId, vectorChunks, 3);

    // Kiểm tra chốt chặn cuối cùng: 100% chunks phải thuộc đúng repoId này
    const strictlyScopedChunks = finalChunks.filter(
      (c) => c.repoId && (c.repoId.toString() === repoId || (c.repoId as any).equals?.(repoObjectId))
    );

    // ── Bước 5: Đóng gói System Prompt & Trích dẫn Citations ──
    const { prompt, citations } = this.buildGroundedPrompt(strictlyScopedChunks, question, repoInfo, history);
    if (onCitations) {
      onCitations(citations);
    }

    // ── Bước 6: Gọi Gemini 2.5 Flash Stream ──
    const fullAnswer = await GeminiService.streamGenerate({
      prompt,
      onToken,
    });

    // ── Bước 7: Lưu vào Semantic Cache (TTL: 24h = 86400s) ──
    try {
      if (fullAnswer && fullAnswer.trim()) {
        await redisConnection.setex(cacheKey, 86400, fullAnswer);
        console.log(`💾 [Redis Cache Saved] Đã lưu kết quả câu hỏi [Repo: ${repoInfo.name}] vào Redis cache.`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [Redis Cache Save Warning]: ${err.message}`);
    }
  }
}
