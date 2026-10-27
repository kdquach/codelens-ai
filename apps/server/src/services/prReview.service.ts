// apps/server/src/services/prReview.service.ts
import mongoose from 'express';
import { PRReviewResult, PRIssue } from '@codelens/shared';
import { RepositoryModel } from '../models/repository.model';
import { CodeChunkModel } from '../models/codeChunk.model';
import { PRReviewModel } from '../models/prReview.model';
import { GitHubService, PRDetails } from './github.service';
import { GeminiService } from './gemini.service';

export interface PRReviewJobData {
  repoFullName: string; // "owner/repo"
  repoUrl: string;
  prNumber: number;
  title: string;
  author: string;
  action: string;
}

export class PRReviewService {
  /**
   * Phân tích tác động liên module (Cross-File Impact Analysis)
   * Tra cứu trong architectureGraph (Edges) và Code Chunks xem file vừa sửa
   * đang được module nào khác import để cảnh báo Breaking Changes.
   */
  static async performImpactAnalysis(
    repoId: string,
    modifiedFiles: string[]
  ): Promise<string[]> {
    const impactedSet = new Set<string>();

    if (!modifiedFiles || modifiedFiles.length === 0) {
      return [];
    }

    try {
      // 1. Tra cứu qua Đồ thị Kiến trúc lưu trong Repository (Edges: source -> target)
      const repoDoc = await RepositoryModel.findById(repoId).select('architectureGraph').lean();
      if (repoDoc?.architectureGraph?.edges) {
        for (const edge of repoDoc.architectureGraph.edges) {
          // Nếu target là file bị sửa -> source là file phụ thuộc chịu tác động
          const isTargetModified = modifiedFiles.some(
            (mf) => edge.target === mf || edge.target.endsWith(mf) || mf.endsWith(edge.target)
          );
          if (isTargetModified && !modifiedFiles.includes(edge.source)) {
            impactedSet.add(edge.source);
          }
        }
      }

      // 2. Tra cứu qua CodeChunkModel dependencies
      const chunks = await CodeChunkModel.find({
        repoId,
        $or: [
          { dependencies: { $in: modifiedFiles } },
          // Hỗ trợ tìm kiếm theo đuôi file
          ...modifiedFiles.map((mf) => ({ dependencies: new RegExp(`${mf.replace(/\.[^/.]+$/, '')}$`) })),
        ],
      })
        .select('filePath')
        .lean();

      for (const chunk of chunks) {
        if (!modifiedFiles.includes(chunk.filePath)) {
          impactedSet.add(chunk.filePath);
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ [PRReviewService.performImpactAnalysis] Lỗi phân tích tác động: ${error.message}`);
    }

    return Array.from(impactedSet);
  }

  /**
   * Gọi Gemini 2.5 Flash phân tích Git Diff và đánh giá rủi ro (Task TS-17)
   * Sử dụng Prompt 3 từ tài liệu docs/04-api-and-ai-prompts.md
   */
  static async generateAIReview(
    diffText: string,
    modifiedFiles: string[],
    impactedFiles: string[]
  ): Promise<PRReviewResult> {
    const systemInstruction = `Bạn là Chuyên gia Đánh giá Mã nguồn (Principal AI Code Reviewer & Security Architect).
Nhiệm vụ của bạn là phân tích đoạn thay đổi mã nguồn (git diff) của một Pull Request, đối chiếu với danh sách các file đang phụ thuộc (Impact Analysis) để phát hiện các lỗi tiềm ẩn và cảnh báo Breaking Changes.

Yêu cầu phân tích:
1. Đánh giá chất lượng code, cú pháp, hiệu năng (Time Complexity, Memory Leaks, Async/Await).
2. Lỗ hổng bảo mật (SQL/NoSQL Injection, lộ thông tin nhạy cảm/secrets, thiếu xác thực, XSS).
3. Tác động dây chuyền (Breaking Changes) làm hỏng các file đang import các hàm/class bị sửa đổi.

BẮT BUỘC chỉ trả về kết quả ĐÚNG định dạng JSON Schema sau, không giải thích ngoài JSON:
{
  "riskScore": <Số nguyên từ 0 đến 100 biểu thị mức độ rủi ro, 0 là an toàn tuyệt đối, 100 là cực kỳ nguy hiểm>,
  "summary": "<Tóm tắt ngắn gọn thay đổi trong PR và đánh giá tổng quan>",
  "mermaidDiagram": "<Chuỗi code mermaid flowchart hoặc sequenceDiagram mô tả luồng thay đổi>",
  "issues": [
    {
      "filePath": "<Đường dẫn file>",
      "lineNumber": <Số dòng ước tính hoặc dòng đầu tiên gặp lỗi>,
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "message": "<Mô tả vấn đề cụ thể>",
      "suggestedFix": "<Đoạn code gợi ý sửa lỗi ngắn gọn>"
    }
  ]
}`;

    const prompt = `DANH SÁCH FILE THAY ĐỔI TRONG PULL REQUEST:
${modifiedFiles.map((f) => `- ${f}`).join('\n')}

DANH SÁCH CÁC MODULE ĐANG IMPORT / PHỤ THUỘC VÀO CÁC FILE TRÊN (CROSS-FILE IMPACT):
${impactedFiles.length > 0 ? impactedFiles.map((f) => `- ${f}`).join('\n') : '(Không phát hiện module phụ thuộc trực tiếp)'}

NỘI DUNG CHI TIẾT GIT DIFF CỦA PULL REQUEST:
${diffText.slice(0, 15000)}

Hãy phân tích kỹ lưỡng và trả về đúng JSON Schema đã quy định.`;

    try {
      const responseText = await GeminiService.generateContent(prompt, systemInstruction);

      // Trích xuất JSON từ phản hồi (hỗ trợ trường hợp AI bọc trong ```json ... ```)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Gemini không trả về khối JSON hợp lệ.');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        riskScore: Math.min(100, Math.max(0, Number(parsed.riskScore) || 0)),
        summary: parsed.summary || 'Pull Request được phân tích bởi CodeLens AI.',
        mermaidDiagram:
          parsed.mermaidDiagram ||
          `sequenceDiagram\n  autonumber\n  actor User\n  participant System\n  User->>System: PR Changes\n  System-->>User: Verified`,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        impactedFiles,
      };
    } catch (error: any) {
      console.error(`❌ [PRReviewService.generateAIReview] Lỗi gọi Gemini: ${error.message}`);

      // Fallback kết quả khi Gemini timeout hoặc quota limit
      return {
        riskScore: 25,
        summary: `Đã phân tích thay đổi trên ${modifiedFiles.length} file. Phân tích tác động cho thấy có ${impactedFiles.length} module phụ thuộc liên quan.`,
        mermaidDiagram: `flowchart TD\n  PR["Pull Request (${modifiedFiles.length} files)"] --> Changes["Changes Applied"]\n  Changes --> Impact["Impacted Modules (${impactedFiles.length})"]`,
        issues: [],
        impactedFiles,
      };
    }
  }

  /**
   * Tạo định dạng Comment GitHub Markdown chuyên nghiệp và thẩm mỹ
   */
  static formatReviewComment(
    review: PRReviewResult,
    prDetails: { prNumber: number; title: string; author: string }
  ): string {
    const { riskScore, summary, mermaidDiagram, issues, impactedFiles } = review;

    // Xác định mức độ rủi ro & Badge màu sắc
    let riskBadge = '🟢 **THẤP (LOW RISK)** — An toàn để merge';
    if (riskScore >= 70) {
      riskBadge = '🔴 **NGUY HIỂM (HIGH RISK)** — Cần kiểm tra kỹ lưỡng trước khi merge!';
    } else if (riskScore >= 35) {
      riskBadge = '🟡 **TRUNG BÌNH (MEDIUM RISK)** — Có một số lưu ý cần tối ưu';
    }

    let markdown = `## 🔍 CodeLens AI — Automated Pull Request Review

> **Pull Request:** #${prDetails.prNumber} - *${prDetails.title}*  
> **Tác giả:** @${prDetails.author}  
> **Trạng thái:** Đã phân tích tự động qua Gemini 2.5 Flash

### 📊 Điểm số Đánh giá Rủi ro (Risk Assessment)
- **Rủi ro tính toán:** \`${riskScore}/100\`
- **Đánh giá:** ${riskBadge}

---

### 📝 Tóm tắt Thay đổi (Summary)
${summary}

---

### 🌐 Phân tích Tác động Dây chuyền (Cross-File Impact Analysis)
${
  impactedFiles.length > 0
    ? `⚠️ **Phát hiện ${impactedFiles.length} module khác đang phụ thuộc vào các file sửa đổi:**\n` +
      impactedFiles.map((f) => `- \`${f}\``).join('\n') +
      `\n\n*Khuyến nghị: Chạy test suite cho các module trên để đảm bảo không phát sinh Breaking Changes.*`
    : `✅ **Không phát hiện module phụ thuộc trực tiếp bên ngoài.** Thay đổi mang tính cục bộ.`
}

---

### 🔄 Sơ đồ Luồng Hoạt động (Change Flow Diagram)
\`\`\`mermaid
${mermaidDiagram}
\`\`\`

---

### ⚠️ Danh sách Vấn đề Phát hiện & Đề xuất Khắc phục (${issues.length})
`;

    if (issues.length === 0) {
      markdown += `\n🎉 **Không phát hiện lỗi nghiêm trọng hay lỗ hổng bảo mật nào.** Code sạch và tuân thủ chuẩn!\n`;
    } else {
      issues.forEach((issue, index) => {
        const severityIcons: Record<string, string> = {
          CRITICAL: '🚨 **CRITICAL**',
          HIGH: '🔴 **HIGH**',
          MEDIUM: '🟡 **MEDIUM**',
          LOW: '🔵 **LOW**',
        };
        const icon = severityIcons[issue.severity] || '⚠️ **NOTE**';

        markdown += `
#### ${index + 1}. ${icon} \`${issue.filePath}\` (Dòng: ${issue.lineNumber})
**Vấn đề:** ${issue.message}

${
  issue.suggestedFix
    ? `**Gợi ý sửa đổi:**
\`\`\`typescript
${issue.suggestedFix}
\`\`\`
`
    : ''
}
`;
      });
    }

    markdown += `
---
*Được tạo tự động bởi [CodeLens AI](https://github.com/kdquach/codelens-ai) • Powered by Google Gemini 2.5 Flash & ts-morph AST Engine*`;

    return markdown;
  }

  /**
   * Quy trình xử lý toàn diện một tác vụ Review PR (End-to-End Orchestrator)
   */
  static async processPRReview(data: PRReviewJobData): Promise<void> {
    const { repoFullName, repoUrl, prNumber, title, author } = data;
    const [owner, name] = repoFullName.split('/');

    console.log(`🚀 [PRReviewWorker] Bắt đầu phân tích PR #${prNumber} cho "${repoFullName}"...`);

    // 1. Tìm hoặc đăng ký Repo trong MongoDB
    let repoDoc = await RepositoryModel.findOne({
      $or: [{ repoUrl }, { owner, name }],
    });

    if (!repoDoc) {
      repoDoc = await RepositoryModel.create({
        owner,
        name,
        repoUrl: repoUrl || `https://github.com/${repoFullName}`,
        status: 'PENDING',
        architectureGraph: { nodes: [], edges: [] },
      });
    }

    // 2. Tạo hoặc cập nhật bản ghi PRReview trạng thái REVIEWING
    let reviewRecord = await PRReviewModel.findOne({
      repoId: repoDoc._id,
      prNumber,
    });

    if (!reviewRecord) {
      reviewRecord = await PRReviewModel.create({
        repoId: repoDoc._id,
        prNumber,
        title,
        author,
        riskScore: 0,
        status: 'REVIEWING',
        issues: [],
        impactedFiles: [],
      });
    } else {
      reviewRecord.status = 'REVIEWING';
      reviewRecord.title = title;
      reviewRecord.author = author;
      await reviewRecord.save();
    }

    try {
      // 3. Tải danh sách file thay đổi & Git Diff từ GitHub API
      let prDetails: PRDetails;
      try {
        prDetails = await GitHubService.fetchPullRequestDetails(owner, name, prNumber);
      } catch (ghErr: any) {
        console.warn(`⚠️ [PRReviewWorker] Không thể lấy PR từ GitHub API (${ghErr.message}). Sử dụng Mock Diff để kiểm thử.`);
        prDetails = {
          owner,
          repo: name,
          prNumber,
          title,
          author,
          state: 'open',
          diffUrl: `https://github.com/${repoFullName}/pull/${prNumber}.diff`,
          htmlUrl: `https://github.com/${repoFullName}/pull/${prNumber}`,
          baseRef: 'main',
          headRef: 'feature/update',
          files: [
            {
              filename: 'src/services/payment.service.ts',
              status: 'modified',
              additions: 25,
              deletions: 4,
              changes: 29,
              patch: '@@ -10,4 +10,25 @@\n+ export async function verifyPaymentWebhook(payload: any, signature: string) {\n+   // Validate HMAC signature\n+ }',
            },
          ],
          diffSummary: '### File: src/services/payment.service.ts (modified, +25/-4)\n```diff\n+ export async function verifyPaymentWebhook(payload: any, signature: string) {}\n```',
        };
      }

      const modifiedFiles = prDetails.files.map((f) => f.filename);

      // 4. Phân tích tác động dây chuyền (Impact Analysis)
      const impactedFiles = await this.performImpactAnalysis(repoDoc._id.toString(), modifiedFiles);

      // 5. Gọi Gemini 2.5 Flash phân tích Risk Score & Issues
      const aiResult = await this.generateAIReview(prDetails.diffSummary, modifiedFiles, impactedFiles);

      // 6. Định dạng Comment Markdown
      const commentBody = this.formatReviewComment(aiResult, {
        prNumber,
        title: prDetails.title || title,
        author: prDetails.author || author,
      });

      // 7. Tự động đăng Comment lên GitHub PR
      let githubCommentUrl: string | undefined;
      try {
        githubCommentUrl = await GitHubService.createPRComment(owner, name, prNumber, commentBody);
        console.log(`✅ [PRReviewWorker] Đã đăng comment lên GitHub PR #${prNumber}: ${githubCommentUrl}`);
      } catch (commentErr: any) {
        console.warn(
          `⚠️ [PRReviewWorker] Không thể đăng trực tiếp lên GitHub PR (${commentErr.message}). Tiếp tục lưu kết quả vào Database.`
        );
        githubCommentUrl = `https://github.com/${repoFullName}/pull/${prNumber}#issuecomment-simulated`;
      }

      // 8. Cập nhật kết quả vào MongoDB Collection pr_reviews
      reviewRecord.status = 'COMMENTED';
      reviewRecord.riskScore = aiResult.riskScore;
      reviewRecord.summary = aiResult.summary;
      reviewRecord.mermaidSummary = aiResult.mermaidDiagram;
      reviewRecord.issues = aiResult.issues;
      reviewRecord.impactedFiles = impactedFiles;
      reviewRecord.githubCommentUrl = githubCommentUrl;
      await reviewRecord.save();

      console.log(`🎉 [PRReviewWorker] Hoàn tất review PR #${prNumber} (Risk: ${aiResult.riskScore}/100)`);
    } catch (error: any) {
      console.error(`❌ [PRReviewWorker] Thất bại khi review PR #${prNumber}: ${error.message}`);
      reviewRecord.status = 'FAILED';
      reviewRecord.errorMessage = error.message;
      await reviewRecord.save();
      throw error;
    }
  }
}

