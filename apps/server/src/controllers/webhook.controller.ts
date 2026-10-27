// apps/server/src/controllers/webhook.controller.ts
import { Request, Response } from 'express';
import { GitHubService } from '../services/github.service';
import { addPRReviewJob } from '../queues/prReview.queue';
import { RepositoryModel } from '../models/repository.model';

export class WebhookController {
  /**
   * POST /api/webhooks/github
   * Tiếp nhận sự kiện Webhook từ GitHub với bảo mật HMAC-SHA256 (Task TS-16)
   */
  static async handleGitHubWebhook(req: Request, res: Response): Promise<void> {
    try {
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const event = req.headers['x-github-event'] as string | undefined;

      // 1. Xác thực chữ ký HMAC-SHA256
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const isVerified = GitHubService.verifyWebhookSignature(rawBody, signature);

      if (!isVerified) {
        console.warn('⛔ [WebhookController] Chữ ký HMAC-SHA256 không hợp lệ!');
        res.status(401).json({ error: 'Invalid HMAC-SHA256 signature.' });
        return;
      }

      // 2. Phản hồi sự kiện kiểm tra kết nối "ping" từ GitHub
      if (event === 'ping') {
        res.status(200).json({
          status: 'OK',
          message: 'Pong! CodeLens AI Webhook is configured successfully.',
          zen: req.body?.zen,
        });
        return;
      }

      // 3. Chỉ tiếp nhận sự kiện "pull_request"
      if (event !== 'pull_request') {
        res.status(200).json({
          status: 'IGNORED',
          message: `Sự kiện "${event}" không nằm trong danh mục xử lý PR Review.`,
        });
        return;
      }

      const { action, pull_request, repository } = req.body;

      // 4. Lọc các action cần review: opened, synchronize (commit mới), reopened
      const ACCEPTED_ACTIONS = ['opened', 'synchronize', 'reopened'];
      if (!ACCEPTED_ACTIONS.includes(action)) {
        res.status(200).json({
          status: 'IGNORED',
          message: `Bỏ qua action "${action}". Chỉ xử lý: ${ACCEPTED_ACTIONS.join(', ')}.`,
        });
        return;
      }

      const repoFullName = repository?.full_name;
      const repoUrl = repository?.html_url;
      const prNumber = pull_request?.number;
      const title = pull_request?.title || 'Untitled PR';
      const author = pull_request?.user?.login || 'unknown';

      if (!repoFullName || !prNumber) {
        res.status(400).json({ error: 'Thiếu thông tin repository hoặc PR number.' });
        return;
      }

      // 5. Đẩy Job vào hàng đợi BullMQ (Phản hồi nhanh < 200ms)
      const job = await addPRReviewJob({
        repoFullName,
        repoUrl,
        prNumber,
        title,
        author,
        action,
      });

      console.log(`📨 [WebhookController] Đã nhận PR #${prNumber} từ "${repoFullName}". Enqueued Job ID: ${job.id}`);

      // Phản hồi 202 Accepted theo chuẩn REST & GitHub Webhook Best Practice
      res.status(202).json({
        status: 'ACCEPTED',
        message: 'Pull Request Review job đã được tiếp nhận và đẩy vào hàng đợi.',
        jobId: job.id,
        repo: repoFullName,
        prNumber,
      });
    } catch (error: any) {
      console.error(`💥 [WebhookController] Lỗi xử lý Webhook: ${error.message}`);
      res.status(500).json({ error: 'Lỗi máy chủ khi tiếp nhận Webhook.' });
    }
  }

  /**
   * POST /api/webhooks/simulate-pr
   * Cho phép Developer hoặc HR mô phỏng kích hoạt PR Review ngay lập tức
   * mà không cần cấu hình Public Webhook URL (phục vụ trải nghiệm & test nhanh).
   */
  static async simulatePRReview(req: Request, res: Response): Promise<void> {
    try {
      const { repoId, repoUrl, prNumber = 1, title = 'Feature: Update Core Logic', author = 'developer' } = req.body;

      let resolvedUrl = repoUrl;
      let repoFullName = '';

      if (repoId) {
        const repoDoc = await RepositoryModel.findById(repoId);
        if (repoDoc) {
          resolvedUrl = repoDoc.repoUrl;
          repoFullName = `${repoDoc.owner}/${repoDoc.name}`;
        }
      }

      if (!resolvedUrl && !repoFullName) {
        resolvedUrl = 'https://github.com/kdquach/CafeVibe';
        repoFullName = 'kdquach/CafeVibe';
      }

      if (!repoFullName && resolvedUrl) {
        const { owner, repo } = GitHubService.parseGitHubUrl(resolvedUrl);
        repoFullName = `${owner}/${repo}`;
      }

      const job = await addPRReviewJob({
        repoFullName,
        repoUrl: resolvedUrl,
        prNumber: Number(prNumber),
        title,
        author,
        action: 'opened',
      });

      res.status(202).json({
        status: 'ACCEPTED',
        message: `Mô phỏng PR Review thành công! Đã đẩy vào queue.`,
        jobId: job.id,
        repo: repoFullName,
        prNumber,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Lỗi mô phỏng PR' });
    }
  }
}

