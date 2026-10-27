import { Octokit } from '@octokit/rest';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────
// GitHub Service — Lấy cây thư mục, nội dung file & PR Webhook
// Sử dụng: Git Tree API (recursive) + Git Blob API (base64) + Pulls API
// ─────────────────────────────────────────────────────────────

/** Thông tin file thô lấy từ GitHub, dùng chung cho cả AST Parser. */
export interface RawRepoFile {
  path: string;
  content: string;
  size: number; // bytes
}

export interface PRFileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PRDetails {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  author: string;
  state: string;
  diffUrl: string;
  htmlUrl: string;
  baseRef: string;
  headRef: string;
  files: PRFileChange[];
  diffSummary: string;
}

/** Metadata cơ bản của một repository GitHub. */
export interface RepoMetadata {
  owner: string;
  name: string;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  updatedAt: string | null;
}

/** Node trên cây thư mục – phục vụ endpoint GET /api/repos/:id/files. */
export interface RepoTreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

// ── Cấu hình ─────────────────────────────────────────────────

/** Các extension mã nguồn được chấp nhận. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Các pattern đường dẫn cần loại bỏ. */
const EXCLUDED_PATTERNS = [
  'node_modules',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  '__tests__/',
  '__mocks__/',
  '.spec.',
  '.test.',
  '.stories.',
  '.d.ts',
  'vendor/',
  '.min.',
  'generated/',
  'migrations/',
  'fixtures/',
];

/** Kích thước file tối đa để tải nội dung (500 KB). */
const MAX_FILE_SIZE_BYTES = 500 * 1024;

/** Số file tải song song mỗi batch (tránh rate-limit 5000 req/h). */
const CONCURRENCY_BATCH_SIZE = 10;

// ── Helper tạo Octokit instance ──────────────────────────────

function createOctokitInstance(token?: string): Octokit {
  return new Octokit({
    auth: token || process.env.GITHUB_TOKEN || undefined,
    request: { timeout: 15_000 },
  });
}

// ── Service chính ────────────────────────────────────────────

export class GitHubService {
  // ┌──────────────────────────────────────────────────────────┐
  // │  Parse GitHub URL → { owner, repo }                     │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Phân tích URL GitHub thành owner/repo.
   * Hỗ trợ: https://github.com/owner/repo[.git][/]
   * @throws Error nếu URL không hợp lệ.
   */
  static parseGitHubUrl(url: string): { owner: string; repo: string } {
    const pattern = /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/;
    const match = url.match(pattern);

    if (!match) {
      throw new Error(
        `URL GitHub không hợp lệ: "${url}". ` +
        `Vui lòng dùng định dạng: https://github.com/owner/repo`
      );
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    return { owner, repo };
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Fetch Repo Metadata                                    │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Lấy metadata cơ bản của repo (default branch, stars, description...).
   */
  static async fetchRepoMetadata(repoUrl: string): Promise<RepoMetadata> {
    const octokit = createOctokitInstance();
    const { owner, repo } = this.parseGitHubUrl(repoUrl);

    try {
      const { data } = await octokit.repos.get({ owner, repo });

      return {
        owner: data.owner.login,
        name: data.name,
        defaultBranch: data.default_branch,
        description: data.description,
        language: data.language,
        stargazersCount: data.stargazers_count,
        forksCount: data.forks_count,
        updatedAt: data.updated_at,
      };
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 404) {
          throw new Error(`Repository không tồn tại: ${owner}/${repo}`);
        }
        if (status === 403) {
          throw new Error(
            `Đã vượt quá GitHub API rate-limit. Hãy cấu hình GITHUB_TOKEN trong .env.`
          );
        }
      }
      throw new Error(`Không thể lấy metadata cho ${owner}/${repo}: ${String(error)}`);
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Fetch Full Repository Tree (cho file explorer)         │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Lấy toàn bộ cây thư mục (đệ quy) – dùng cho sidebar file explorer.
   * Chỉ trả về file code + thư mục chứa chúng.
   */
  static async fetchRepoTree(repoUrl: string): Promise<RepoTreeNode[]> {
    const octokit = createOctokitInstance();
    const { owner, repo } = this.parseGitHubUrl(repoUrl);

    try {
      const metadata = await this.fetchRepoMetadata(repoUrl);

      const { data: treeData } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: metadata.defaultBranch,
        recursive: 'true',
      });

      // Lọc & trả về cấu trúc tree gọn nhẹ
      return treeData.tree
        .filter((item): item is typeof item & { path: string } => {
          if (!item.path) return false;
          if (EXCLUDED_PATTERNS.some((p) => item.path!.includes(p))) return false;

          // Giữ lại thư mục hoặc file source code
          if (item.type === 'tree') return true;
          return item.type === 'blob' && SOURCE_EXTENSIONS.test(item.path);
        })
        .map((item) => ({
          path: item.path!,
          type: item.type as 'blob' | 'tree',
          size: item.size ?? undefined,
        }));
    } catch (error: unknown) {
      if (error instanceof Error) throw error; // Re-throw nếu đã xử lý
      throw new Error(`Không thể lấy cây thư mục: ${String(error)}`);
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Fetch Source Files (cho AST Parser / Ingestion)        │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Lấy nội dung mã nguồn từ GitHub. Quy trình:
   * 1. Git Tree API (recursive) → danh sách file
   * 2. Lọc theo extension, loại trừ pattern, giới hạn size
   * 3. Git Blob API (batch song song) → nội dung base64 → decode UTF-8
   *
   * @param repoUrl    - URL GitHub repository
   * @param maxFiles   - Giới hạn số file tối đa (mặc định 60)
   * @param onProgress - Callback báo tiến trình (0.0 → 1.0)
   */
  static async fetchRepoSourceFiles(
    repoUrl: string,
    maxFiles = 60,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<RawRepoFile[]> {
    const octokit = createOctokitInstance();
    const { owner, repo } = this.parseGitHubUrl(repoUrl);

    // ── Bước 1: Lấy default branch ──
    onProgress?.(0.05, 'Đang lấy thông tin repository...');

    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // ── Bước 2: Lấy toàn bộ cây thư mục (recursive) ──
    onProgress?.(0.1, 'Đang quét cây thư mục...');

    const { data: treeData } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: 'true',
    });

    if (treeData.truncated) {
      console.warn(
        `⚠️ [GitHubService] Cây thư mục bị cắt bớt (repo quá lớn). ` +
        `Chỉ xử lý ${treeData.tree.length} entries.`
      );
    }

    // ── Bước 3: Lọc file hợp lệ ──
    const validFiles = treeData.tree.filter(
      (item): item is typeof item & { path: string; sha: string } =>
        item.type === 'blob' &&
        typeof item.path === 'string' &&
        typeof item.sha === 'string' &&
        SOURCE_EXTENSIONS.test(item.path) &&
        !EXCLUDED_PATTERNS.some((p) => item.path!.includes(p)) &&
        (item.size == null || item.size <= MAX_FILE_SIZE_BYTES),
    );

    // Ưu tiên các file thuộc thư mục mã nguồn chính (src, app, lib, controllers, services...)
    // và sắp xếp theo đường dẫn để các file cùng thư mục / liên kết nhau được giữ lại
    const CORE_DIR_PRIORITY = ['src/', 'app/', 'lib/', 'controllers/', 'services/', 'models/', 'components/', 'routes/'];

    const sortedFiles = validFiles
      .sort((a, b) => {
        const aHasCore = CORE_DIR_PRIORITY.some((dir) => a.path.includes(dir)) ? 0 : 1;
        const bHasCore = CORE_DIR_PRIORITY.some((dir) => b.path.includes(dir)) ? 0 : 1;
        if (aHasCore !== bHasCore) return aHasCore - bHasCore;
        // Cùng độ ưu tiên thì sắp xếp theo đường dẫn để gom nhóm cùng module
        return a.path.localeCompare(b.path);
      })
      .slice(0, maxFiles);

    onProgress?.(
      0.15,
      `Tìm thấy ${validFiles.length} file hợp lệ, sẽ tải ${sortedFiles.length} file.`,
    );

    // ── Bước 4: Tải nội dung song song theo batch ──
    const results: RawRepoFile[] = [];
    const totalFiles = sortedFiles.length;

    for (let i = 0; i < totalFiles; i += CONCURRENCY_BATCH_SIZE) {
      const batch = sortedFiles.slice(i, i + CONCURRENCY_BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (file) => {
          return this.fetchFileContent(octokit, owner, repo, file.path, file.sha);
        }),
      );

      // Xử lý kết quả từng file trong batch
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled' && result.value !== null) {
          results.push(result.value);
        } else if (result.status === 'rejected') {
          const failedPath = batch[j].path;
          console.warn(
            `⚠️ [GitHubService] Bỏ qua file "${failedPath}": ${String(result.reason)}`
          );
        }
      }

      // Cập nhật tiến trình (0.15 → 0.95)
      const fetchedSoFar = Math.min(i + CONCURRENCY_BATCH_SIZE, totalFiles);
      const progress = 0.15 + (fetchedSoFar / totalFiles) * 0.8;
      onProgress?.(
        progress,
        `Đã tải ${results.length}/${totalFiles} files...`,
      );
    }

    onProgress?.(1.0, `Hoàn tất: ${results.length} files.`);

    console.log(
      `✅ [GitHubService] Fetched ${results.length}/${totalFiles} files from ${owner}/${repo}`
    );

    return results;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Fetch Single File Content (cho Monaco Editor)          │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Lấy nội dung 1 file cụ thể – dùng cho Monaco Editor preview.
   * @param repoUrl  - URL repository
   * @param filePath - Đường dẫn file trong repo (VD: "src/services/auth.ts")
   */
  static async fetchSingleFile(
    repoUrl: string,
    filePath: string,
  ): Promise<RawRepoFile> {
    const octokit = createOctokitInstance();
    const { owner, repo } = this.parseGitHubUrl(repoUrl);

    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if (Array.isArray(data)) {
        throw new Error(`"${filePath}" là thư mục, không phải file.`);
      }

      if (!('content' in data) || !data.content) {
        throw new Error(`Không thể đọc nội dung file "${filePath}".`);
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      return {
        path: filePath,
        content,
        size: data.size,
      };
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 404) {
          throw new Error(`File không tồn tại: ${filePath}`);
        }
      }
      if (error instanceof Error) throw error;
      throw new Error(`Lỗi khi tải file "${filePath}": ${String(error)}`);
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Private: Tải nội dung file qua Git Blob API            │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Tải nội dung file bằng Git Blob API (nhanh hơn getContent cho batch).
   * Blob API trả về base64 trực tiếp, không cần redirect.
   */
  private static async fetchFileContent(
    octokit: Octokit,
    owner: string,
    repo: string,
    filePath: string,
    sha: string,
  ): Promise<RawRepoFile | null> {
    try {
      const { data: blobData } = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: sha,
      });

      if (blobData.encoding !== 'base64') {
        console.warn(
          `⚠️ [GitHubService] Encoding không hỗ trợ cho "${filePath}": ${blobData.encoding}`
        );
        return null;
      }

      const content = Buffer.from(blobData.content, 'base64').toString('utf-8');

      // Bỏ qua file binary (có ký tự null)
      if (content.includes('\0')) {
        console.warn(`⚠️ [GitHubService] Bỏ qua file binary: "${filePath}"`);
        return null;
      }

      return {
        path: filePath,
        content,
        size: blobData.size ?? content.length,
      };
    } catch (error: unknown) {
      console.warn(
        `⚠️ [GitHubService] Lỗi tải blob "${filePath}": ${String(error)}`
      );
      return null;
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Task TS-16: Webhook HMAC-SHA256 Signature Verification   │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Xác thực chữ ký HMAC-SHA256 từ header X-Hub-Signature-256 của GitHub.
   * Ngăn chặn giả mạo Webhook bằng cách so sánh thời gian an toàn (crypto.timingSafeEqual).
   */
  static verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader?: string,
    secret: string = process.env.GITHUB_WEBHOOK_SECRET || ''
  ): boolean {
    if (!secret) {
      console.warn('⚠️ [GitHubService] GITHUB_WEBHOOK_SECRET chưa được đặt trong .env. Bỏ qua xác thực chữ ký Webhook.');
      return true;
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', secret);
      const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf-8') : rawBody;
      hmac.update(bodyBuffer);
      const expectedSignature = `sha256=${hmac.digest('hex')}`;

      const sigBuffer = Buffer.from(signatureHeader);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err: any) {
      console.error(`❌ [GitHubService] Lỗi xác thực Webhook HMAC-SHA256: ${err.message}`);
      return false;
    }
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Task TS-17: Fetch Pull Request Details & Files Diff      │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Lấy chi tiết Pull Request và danh sách các file thay đổi (kèm patch/diff hunks).
   */
  static async fetchPullRequestDetails(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PRDetails> {
    const octokit = createOctokitInstance();

    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const changedFiles: PRFileChange[] = files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));

    // Tổng hợp nội dung diff có cấu trúc để nạp vào prompt Gemini
    const diffSummary = changedFiles
      .map((f) => {
        return `### File: ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch || '(No patch content / binary change)'}\n\`\`\``;
      })
      .join('\n\n');

    return {
      owner,
      repo,
      prNumber,
      title: pr.title,
      author: pr.user?.login || 'unknown',
      state: pr.state,
      diffUrl: pr.diff_url,
      htmlUrl: pr.html_url,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      files: changedFiles,
      diffSummary,
    };
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Task TS-17: Post Comment trực tiếp lên GitHub PR        │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Đăng báo cáo kết quả review lên GitHub Pull Request thông qua GitHub Issues/Comments API.
   * @returns URL dẫn tới comment vừa tạo trên GitHub
   */
  static async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentBody: string
  ): Promise<string> {
    const octokit = createOctokitInstance();

    const { data } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });

    return data.html_url;
  }

  // ┌──────────────────────────────────────────────────────────┐
  // │  Task TS-23: Quản lý Bật/Tắt Webhook Auto-Review PR      │
  // └──────────────────────────────────────────────────────────┘

  /**
   * Cấu hình Webhook Auto-Review trên GitHub repository.
   * Nếu thành công, trả về GitHub webhook ID.
   * Nếu không có quyền quản trị repo hoặc môi trường local, tự động kích hoạt Webhook mô phỏng (Demo mode).
   */
  static async createRepoWebhook(
    repoUrl: string,
    webhookUrl: string,
    secret?: string,
    userToken?: string
  ): Promise<{ webhookId: string; isSimulated: boolean }> {
    const { owner, repo } = this.parseGitHubUrl(repoUrl);
    const token = userToken || process.env.GITHUB_TOKEN;

    if (token) {
      try {
        const octokit = createOctokitInstance(token);
        const { data } = await octokit.repos.createWebhook({
          owner,
          repo,
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: secret || process.env.GITHUB_WEBHOOK_SECRET || 'codelens_webhook_secret',
          },
          events: ['pull_request'],
          active: true,
        });

        console.log(`✅ [GitHubService] Đã tạo GitHub Webhook thực tế: ${data.id} trên ${owner}/${repo}`);
        return { webhookId: String(data.id), isSimulated: false };
      } catch (err: any) {
        console.warn(`⚠️ [GitHubService] Không thể tạo webhook thực tế qua GitHub API (${err.message}). Kích hoạt Webhook mô phỏng cho Demo.`);
      }
    }

    // Fallback: Webhook mô phỏng
    const simulatedId = `wh_demo_${Date.now()}`;
    return { webhookId: simulatedId, isSimulated: true };
  }

  /**
   * Xóa Webhook trên GitHub repository
   */
  static async deleteRepoWebhook(
    repoUrl: string,
    webhookId: string,
    userToken?: string
  ): Promise<boolean> {
    if (!webhookId) return false;
    if (webhookId.startsWith('wh_demo_')) {
      return true;
    }

    const { owner, repo } = this.parseGitHubUrl(repoUrl);
    const token = userToken || process.env.GITHUB_TOKEN;

    if (token) {
      try {
        const octokit = createOctokitInstance(token);
        await octokit.repos.deleteWebhook({
          owner,
          repo,
          hook_id: Number(webhookId),
        });
        console.log(`✅ [GitHubService] Đã xóa Webhook ID: ${webhookId} trên ${owner}/${repo}`);
        return true;
      } catch (err: any) {
        console.warn(`⚠️ [GitHubService] Lỗi xóa Webhook trên GitHub (${err.message}): bỏ qua xóa online.`);
      }
    }
    return true;
  }
}
