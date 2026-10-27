// apps/server/src/controllers/repo.controller.ts
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { IngestProgressEvent, CodeCitation } from '@codelens/shared';
import { RepositoryModel } from '../models/repository.model';
import { CodeChunkModel } from '../models/codeChunk.model';
import { ChatSessionModel } from '../models/chatSession.model';
import { PRReviewModel } from '../models/prReview.model';
import { checkAndResetUserQuota } from '../models/user.model';
import { GitHubService } from '../services/github.service';
import { RagService } from '../services/rag.service';
import { addIngestJob } from '../queues/ingest.queue';
import { createRedisClient } from '../config/redis';
import { getRepoProgressChannel } from '../workers/ingest.worker';
import { decryptToken } from '../utils/crypto';

export class RepoController {
  /**
   * GET /api/repos
   * Lấy danh sách các Repositories: gồm Sample Repos và Repos thuộc sở hữu của User đang đăng nhập (Task TS-21)
   */
  static async getRepos(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;
      const filter: any = user
        ? {
            $or: [{ isSample: true }, { userId: user._id }],
          }
        : {
            $or: [{ isSample: true }, { status: 'COMPLETED' }],
          };

      const repos = await RepositoryModel.find(filter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .select(
          'owner name repoUrl status isSample webhookActive webhookId summary description createdAt updatedAt userId'
        )
        .lean();

      res.json(repos);
    } catch (error: any) {
      console.error('❌ [RepoController.getRepos] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi lấy danh sách repositories' });
    }
  }

  /**
   * GET /api/repos/samples
   * Lấy danh sách các Repository mẫu đã phân tích sẵn (Task TS-18)
   */
  static async getSampleRepos(_req: Request, res: Response): Promise<void> {
    try {
      const samples = await RepositoryModel.find({
        $or: [{ isSample: true }, { status: 'COMPLETED' }],
      })
        .limit(10)
        .select('owner name repoUrl status architectureGraph isSample webhookActive summary description createdAt')
        .lean();

      res.json(samples);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Lỗi lấy danh sách sample repos' });
    }
  }

  /**
   * POST /api/repos/ingest
   * Nhận repoUrl, kiểm tra Quota (Task TS-21), tạo bản ghi PENDING và đẩy job vào BullMQ Queue
   */
  static async ingestRepo(req: Request, res: Response): Promise<void> {
    try {
      const { repoUrl } = req.body;
      const user = req.user;

      if (!repoUrl) {
        res.status(400).json({ message: 'Tham số "repoUrl" là bắt buộc.' });
        return;
      }

      // Kiểm soát Quota NFR3 (Tối đa 3 repos/ngày) nếu người dùng đã đăng nhập
      if (user) {
        const wasReset = checkAndResetUserQuota(user);
        if (wasReset) {
          await user.save();
        }

        if (user.quota.dailyReposLeft <= 0) {
          res.status(429).json({
            message: 'Hạn mức nạp repository hôm nay đã hết (Tối đa 3 repos/ngày). Vui lòng quay lại vào ngày mai.',
            quota: user.quota,
          });
          return;
        }

        // Trừ quota nạp repo
        user.quota.dailyReposLeft -= 1;
        await user.save();
      }

      const { owner, repo } = GitHubService.parseGitHubUrl(repoUrl);

      // Tìm hoặc tạo mới Repository trong cơ sở dữ liệu MongoDB
      let repoDoc = await RepositoryModel.findOne({ repoUrl });
      if (!repoDoc) {
        repoDoc = await RepositoryModel.create({
          userId: user?._id || null,
          owner,
          name: repo,
          repoUrl,
          status: 'PENDING',
        });
      } else {
        // Gán userId nếu repo chưa có owner
        if (!repoDoc.userId && user) {
          repoDoc.userId = user._id;
        }
        // Nếu repo đã tồn tại, reset lại trạng thái PENDING để quét lại
        repoDoc.status = 'PENDING';
        await repoDoc.save();
      }

      // Đẩy job vào BullMQ Ingest Queue
      const job = await addIngestJob({
        repoId: repoDoc._id.toString(),
        repoUrl,
      });

      // Trả về ngay 202 Accepted kèm thông tin repo & jobId (Non-blocking)
      res.status(202).json({
        message: 'Repository ingestion job queued successfully',
        repoId: repoDoc._id,
        jobId: job.id,
        status: repoDoc.status,
        quota: user ? user.quota : undefined,
      });
    } catch (error: any) {
      console.error('❌ [RepoController.ingestRepo] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi xử lý nạp repository' });
    }
  }

  /**
   * DELETE /api/repos/:id
   * Xóa dự án và toàn bộ dữ liệu phụ thuộc (Code Chunks, Chat Sessions, PR Reviews) (Task TS-21)
   */
  static async deleteRepo(req: Request, res: Response): Promise<void> {
    try {
      const { id: repoId } = req.params;
      const user = req.user;

      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        res.status(400).json({ message: 'Repository ID không hợp lệ.' });
        return;
      }

      const repo = await RepositoryModel.findById(repoId);
      if (!repo) {
        res.status(404).json({ message: 'Không tìm thấy repository cần xóa.' });
        return;
      }

      // Không cho phép xóa Sample Repo dùng chung của bản Demo (trừ ADMIN)
      if (repo.isSample && user?.role !== 'ADMIN') {
        res.status(403).json({
          message: 'Không thể xóa Repository mẫu (Sample Repo) dùng chung của hệ thống.',
        });
        return;
      }

      // Kiểm tra quyền sở hữu
      const isOwner = repo.userId && user && repo.userId.toString() === user._id.toString();
      const isAdmin = user?.role === 'ADMIN';

      if (repo.userId && !isOwner && !isAdmin) {
        res.status(403).json({ message: 'Bạn không có quyền xóa repository này.' });
        return;
      }

      // Xóa đồng loạt toàn bộ dữ liệu phụ thuộc theo tầng (Cascade delete)
      const repoObjectId = new mongoose.Types.ObjectId(repoId);
      await Promise.all([
        CodeChunkModel.deleteMany({ $or: [{ repoId: repoObjectId }, { repoId }] }),
        ChatSessionModel.deleteMany({ $or: [{ repoId: repoObjectId }, { repoId }] }),
        PRReviewModel.deleteMany({ $or: [{ repoId: repoObjectId }, { repoId }] }),
        RepositoryModel.findByIdAndDelete(repoObjectId),
      ]);

      res.json({
        message: 'Repository và toàn bộ dữ liệu liên quan đã được xóa thành công.',
        repoId,
      });
    } catch (error: any) {
      console.error('❌ [RepoController.deleteRepo] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi xóa repository' });
    }
  }

  /**
   * GET /api/repos/:id/progress (và alias /api/repos/:id/stream-status)
   * Server-Sent Events (SSE) phát tiến độ phần trăm (%) theo thời gian thực cho Frontend
   */
  static async streamProgress(req: Request, res: Response): Promise<void> {
    const { id: repoId } = req.params;

    // Thiết lập SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendSSE = (event: IngestProgressEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        sendSSE({
          repoId,
          progress: 0,
          step: 'FAILED',
          message: 'Repository ID không hợp lệ.',
        });
        res.end();
        return;
      }

      const repoDoc = await RepositoryModel.findById(repoId);
      if (!repoDoc) {
        sendSSE({
          repoId,
          progress: 0,
          step: 'FAILED',
          message: `Không tìm thấy repository với ID: ${repoId}`,
        });
        res.end();
        return;
      }

      if (repoDoc.status === 'COMPLETED') {
        sendSSE({
          repoId,
          progress: 100,
          step: 'COMPLETED',
          message: 'Quá trình phân tích mã nguồn đã hoàn tất.',
        });
        res.end();
        return;
      }

      if (repoDoc.status === 'FAILED') {
        sendSSE({
          repoId,
          progress: 0,
          step: 'FAILED',
          message: 'Quá trình phân tích repository đã thất bại trước đó.',
        });
        res.end();
        return;
      }

      sendSSE({
        repoId,
        progress: 5,
        step: 'FETCHING',
        message: 'Đang kết nối Redis channel để nhận tiến độ...',
      });

      const subscriber = createRedisClient();
      const channel = getRepoProgressChannel(repoId);

      await subscriber.subscribe(channel);

      subscriber.on('message', (_chan, message) => {
        try {
          const event: IngestProgressEvent = JSON.parse(message);
          sendSSE(event);

          if (event.step === 'COMPLETED' || event.step === 'FAILED') {
            subscriber.unsubscribe(channel).catch(() => {});
            subscriber.quit().catch(() => {});
            res.end();
          }
        } catch (err) {
          console.error(`❌ [SSE Parser Error]`, err);
        }
      });

      req.on('close', () => {
        subscriber.unsubscribe(channel).catch(() => {});
        subscriber.quit().catch(() => {});
        res.end();
      });
    } catch (error: any) {
      console.error(`❌ [RepoController.streamProgress] Lỗi:`, error);
      sendSSE({
        repoId,
        progress: 0,
        step: 'FAILED',
        message: error.message || 'Lỗi kết nối Server-Sent Events',
      });
      res.end();
    }
  }

  /**
   * GET /api/repos/:id
   * Lấy thông tin chi tiết Repository kèm cấu trúc đồ thị architectureGraph (nodes & edges)
   */
  static async getRepoById(req: Request, res: Response): Promise<void> {
    try {
      const repo = await RepositoryModel.findById(req.params.id);
      if (!repo) {
        res.status(404).json({ message: 'Repository not found' });
        return;
      }
      res.json(repo);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * GET /api/repos/:id/files
   * Lấy danh sách các chunks hoặc nội dung file cụ thể để hiển thị lên Monaco Editor
   */
  static async getFileContent(req: Request, res: Response): Promise<void> {
    try {
      const { id: repoId } = req.params;
      const { path } = req.query;

      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        res.status(400).json({ message: 'Repository ID không hợp lệ.' });
        return;
      }

      const repoObjectId = new mongoose.Types.ObjectId(repoId);

      if (!path) {
        const files = await CodeChunkModel.distinct('filePath', {
          $or: [{ repoId: repoObjectId }, { repoId }],
        });
        res.json({ files });
        return;
      }

      const chunks = await CodeChunkModel.find({
        $or: [{ repoId: repoObjectId }, { repoId }],
        filePath: String(path),
      })
        .sort({ startLine: 1 })
        .lean();

      res.json({ filePath: path, chunks });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  /**
   * POST /api/repos/:id/chat (SSE Streaming)
   * Hỏi đáp mã nguồn sử dụng Code-Aware RAG (Vector Search + Graph Expansion + Semantic Caching)
   * Kiểm soát Quota NFR3 và tự động lưu phiên vào CHAT_SESSIONS (Task TS-21, TS-22)
   */
  static async streamChat(req: Request, res: Response): Promise<void> {
    const { id: repoId } = req.params;
    const { question, selectedFile, history } = req.body;
    const user = req.user;

    // Thiết lập SSE Headers chuẩn
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!question || !question.trim()) {
      res.write(`data: ${JSON.stringify({ error: 'Câu hỏi không được để trống.' })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
      res.write(`data: ${JSON.stringify({ error: `Repository ID "${repoId}" không hợp lệ hoặc chưa được chọn.` })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
      return;
    }

    // ── Kiểm tra Quota NFR3 (Tối đa 20 queries/ngày) ──
    if (user) {
      const wasReset = checkAndResetUserQuota(user);
      if (wasReset) {
        await user.save();
      }

      if (user.quota.dailyQueriesLeft <= 0) {
        res.write(
          `data: ${JSON.stringify({
            error: 'Hạn mức câu hỏi hôm nay đã hết (Tối đa 20 câu/ngày). Vui lòng quay lại vào ngày mai.',
          })}\n\n`
        );
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      // Trừ quota câu hỏi
      user.quota.dailyQueriesLeft -= 1;
      await user.save();
    }

    try {
      const repoObjectId = new mongoose.Types.ObjectId(repoId);

      // Kiểm tra Repository có tồn tại không
      const repo = await RepositoryModel.findById(repoObjectId).lean();
      if (!repo) {
        res.write(`data: ${JSON.stringify({ error: `Repository với ID "${repoId}" không tồn tại.` })}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }

      // Flag kiểm tra xem kết nối phía client đã đóng chưa
      let isAborted = false;
      req.on('close', () => {
        isAborted = true;
      });

      // Mảng tích lũy response để lưu vào CHAT_SESSIONS
      const tokens: string[] = [];
      let capturedCitations: CodeCitation[] = [];

      // Thực thi Code-Aware RAG Pipeline qua RagService
      await RagService.streamChat({
        repoId,
        question,
        selectedFile,
        history,
        onToken: (token) => {
          tokens.push(token);
          if (!isAborted) {
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }
        },
        onCitations: (citations) => {
          capturedCitations = citations || [];
          if (!isAborted && citations && citations.length > 0) {
            res.write(`data: ${JSON.stringify({ citations })}\n\n`);
          }
        },
      });

      // ── Task TS-22: Tự động lưu hội thoại vào ChatSessionModel ──
      const fullResponse = tokens.join('');
      if (fullResponse && fullResponse.trim()) {
        try {
          // Trích xuất Mermaid diagram code nếu có trong câu trả lời
          const mermaidMatch = fullResponse.match(/```mermaid\s*([\s\S]*?)```/);
          const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : undefined;

          // Tìm session gần nhất của user trên repo này hoặc tạo mới
          const sessionFilter: any = { repoId: repoObjectId };
          if (user) {
            sessionFilter.userId = user._id;
          } else {
            sessionFilter.userId = null;
          }

          let session = await ChatSessionModel.findOne(sessionFilter).sort({ updatedAt: -1 });

          const userMsg = {
            role: 'user' as const,
            content: question.trim(),
            createdAt: new Date(),
          };

          const assistantMsg = {
            role: 'assistant' as const,
            content: fullResponse.trim(),
            citations: capturedCitations,
            mermaidCode,
            createdAt: new Date(),
          };

          if (!session) {
            const autoTitle =
              question.trim().slice(0, 45) + (question.trim().length > 45 ? '...' : '');
            session = await ChatSessionModel.create({
              repoId: repoObjectId,
              userId: user ? user._id : null,
              title: autoTitle,
              messages: [userMsg, assistantMsg],
            });
          } else {
            session.messages.push(userMsg);
            session.messages.push(assistantMsg);
            await session.save();
          }
        } catch (saveErr: any) {
          console.warn(`⚠️ [ChatSession Save Warning]: ${saveErr.message}`);
        }
      }

      if (!isAborted) {
        res.write(`data: [DONE]\n\n`);
        res.end();
      }
    } catch (error: any) {
      console.error(`❌ [RepoController.streamChat] Lỗi xử lý RAG:`, error);
      res.write(`data: ${JSON.stringify({ error: error.message || 'Lỗi xử lý câu hỏi qua AI' })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      res.end();
    }
  }

  /**
   * GET /api/repos/:id/chat-history
   * Tải lại lịch sử trò chuyện khi người dùng chuyển đổi giữa các dự án (Task TS-22)
   */
  static async getChatHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id: repoId } = req.params;
      const user = req.user;

      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        res.status(400).json({ message: 'Repository ID không hợp lệ.' });
        return;
      }

      const repoObjectId = new mongoose.Types.ObjectId(repoId);
      const query: any = { repoId: repoObjectId };
      if (user) {
        query.userId = user._id;
      } else {
        query.userId = null;
      }

      const session = await ChatSessionModel.findOne(query).sort({ updatedAt: -1 }).lean();

      res.json({
        sessionId: session?._id || null,
        title: session?.title || 'Đoạn hội thoại mới',
        messages: session?.messages || [],
      });
    } catch (error: any) {
      console.error('❌ [RepoController.getChatHistory] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi tải lịch sử chat' });
    }
  }

  /**
   * DELETE /api/repos/:id/chat-history
   * Xóa lịch sử trò chuyện của dự án hiện tại (Task TS-22)
   */
  static async clearChatHistory(req: Request, res: Response): Promise<void> {
    try {
      const { id: repoId } = req.params;
      const user = req.user;

      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        res.status(400).json({ message: 'Repository ID không hợp lệ.' });
        return;
      }

      const repoObjectId = new mongoose.Types.ObjectId(repoId);
      const query: any = { repoId: repoObjectId };
      if (user) {
        query.userId = user._id;
      } else {
        query.userId = null;
      }

      await ChatSessionModel.deleteMany(query);

      res.json({ message: 'Lịch sử trò chuyện đã được xóa thành công.' });
    } catch (error: any) {
      console.error('❌ [RepoController.clearChatHistory] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi xóa lịch sử chat' });
    }
  }

  /**
   * POST /api/repos/:id/webhook/toggle
   * Bật hoặc tắt tính năng Auto-Review Pull Request qua Webhook (Task TS-23 - UC11)
   */
  static async toggleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const { id: repoId } = req.params;
      const { active } = req.body;
      const user = req.user;

      if (!repoId || !mongoose.Types.ObjectId.isValid(repoId)) {
        res.status(400).json({ message: 'Repository ID không hợp lệ.' });
        return;
      }

      const repo = await RepositoryModel.findById(repoId);
      if (!repo) {
        res.status(404).json({ message: 'Không tìm thấy repository.' });
        return;
      }

      // Xác định trạng thái mục tiêu (bật hay tắt)
      const targetActive = typeof active === 'boolean' ? active : !repo.webhookActive;

      // Lấy GitHub token của User đã giải mã (nếu có) hoặc dùng GITHUB_TOKEN hệ thống
      let userToken: string | undefined = undefined;
      if (user?.encryptedGithubToken) {
        userToken = decryptToken(user.encryptedGithubToken);
      }

      if (targetActive) {
        // ── BẬT WEBHOOK ──
        const baseUrl = process.env.WEBHOOK_BASE_URL || 'https://api.codelens.ai';
        const webhookUrl = `${baseUrl}/api/webhooks/github`;

        const result = await GitHubService.createRepoWebhook(
          repo.repoUrl,
          webhookUrl,
          process.env.GITHUB_WEBHOOK_SECRET,
          userToken
        );

        repo.webhookActive = true;
        repo.webhookId = result.webhookId;
        await repo.save();

        res.json({
          success: true,
          webhookActive: true,
          webhookId: repo.webhookId,
          isSimulated: result.isSimulated,
          message: result.isSimulated
            ? 'Đã kích hoạt Webhook Auto-Review PR ở chế độ Demo/Simulated!'
            : 'Đã tạo và kích hoạt GitHub Webhook Auto-Review PR thành công!',
        });
      } else {
        // ── TẮT WEBHOOK ──
        if (repo.webhookId) {
          await GitHubService.deleteRepoWebhook(repo.repoUrl, repo.webhookId, userToken);
        }

        repo.webhookActive = false;
        repo.webhookId = null;
        await repo.save();

        res.json({
          success: true,
          webhookActive: false,
          webhookId: null,
          message: 'Đã tắt tính năng Auto-Review PR trên repository.',
        });
      }
    } catch (error: any) {
      console.error('❌ [RepoController.toggleWebhook] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi cấu hình webhook' });
    }
  }
}
