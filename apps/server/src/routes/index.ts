// apps/server/src/routes/index.ts
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { RepoController } from '../controllers/repo.controller';
import { WebhookController } from '../controllers/webhook.controller';
import { PRReviewController } from '../controllers/prReview.controller';
import { requireAuth, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// ── Auth & OAuth APIs (Sprint 5 - Task TS-20 - UC07) ──
router.get('/auth/github', AuthController.githubLogin);
router.get('/auth/github/callback', AuthController.githubCallback);
router.post('/auth/demo-login', AuthController.demoLogin);
router.get('/auth/me', requireAuth, AuthController.getMe);

// ── Multi-Repository Management APIs (Sprint 5 - Task TS-21) ──
router.get('/repos', optionalAuth, RepoController.getRepos);
router.get('/repos/samples', RepoController.getSampleRepos);
router.post('/repos/ingest', optionalAuth, RepoController.ingestRepo);
router.delete('/repos/:id', requireAuth, RepoController.deleteRepo);

// ── Ingestion Progress APIs (Sprint 2) ──
router.get('/repos/:id/progress', RepoController.streamProgress);
router.get('/repos/:id/stream-status', RepoController.streamProgress);

// ── Repository Details & Files (Sprint 3) ──
router.get('/repos/:id', RepoController.getRepoById);
router.get('/repos/:id/files', RepoController.getFileContent);

// ── Git Branches & Commits APIs (Sprint 6 - Multi-Tab Dashboard) ──
router.get('/repos/:id/branches', optionalAuth, RepoController.getRepoBranches);
router.get('/repos/:id/commits', optionalAuth, RepoController.getRepoCommits);
router.get('/repos/:id/commits/:sha', optionalAuth, RepoController.getCommitDetail);
router.post('/repos/:id/commits/:sha/summarize', optionalAuth, RepoController.summarizeCommit);

// ── Code-Aware RAG Chat & Chat Sessions APIs (Sprint 3 & 5 - Task TS-22) ──
router.post('/repos/:id/chat', optionalAuth, RepoController.streamChat);
router.get('/repos/:id/chat-history', optionalAuth, RepoController.getChatHistory);
router.delete('/repos/:id/chat-history', optionalAuth, RepoController.clearChatHistory);

// ── Webhook Auto-Review PR Toggle (Sprint 5 - Task TS-23 - UC11) ──
router.post('/repos/:id/webhook/toggle', requireAuth, RepoController.toggleWebhook);

// ── GitHub Webhook & PR Review APIs (Sprint 4 - Task TS-16 & TS-17) ──
router.post('/webhooks/github', WebhookController.handleGitHubWebhook);
router.post('/webhooks/simulate-pr', WebhookController.simulatePRReview);
router.get('/repos/:id/reviews', PRReviewController.getRepoReviews);
router.get('/reviews/:reviewId', PRReviewController.getReviewById);

export default router;
