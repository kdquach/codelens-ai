// apps/server/src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import { UserModel, IUser, checkAndResetUserQuota } from '../models/user.model';
import { generateAuthToken } from '../middlewares/auth.middleware';
import { encryptToken } from '../utils/crypto';
import { UserProfile } from '@codelens/shared';

export class AuthController {
  /**
   * Helper chuyển đổi IUser Document sang UserProfile DTO
   */
  public static formatUserProfile(user: IUser): UserProfile {
    return {
      id: user._id.toString(),
      githubId: user.githubId,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      quota: {
        dailyReposLeft: user.quota?.dailyReposLeft ?? 3,
        dailyQueriesLeft: user.quota?.dailyQueriesLeft ?? 20,
        lastResetAt: user.quota?.lastResetAt ?? new Date(),
      },
      createdAt: user.createdAt,
    };
  }

  /**
   * GET /api/auth/github
   * Chuyển hướng người dùng sang trang cấp quyền của GitHub OAuth
   */
  static async githubLogin(req: Request, res: Response): Promise<void> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      res.status(400).json({
        message: 'GITHUB_CLIENT_ID chưa được cấu hình. Vui lòng sử dụng POST /api/auth/demo-login để trải nghiệm nhanh!',
      });
      return;
    }

    const redirectUri = process.env.GITHUB_CALLBACK_URL || 'http://localhost:4000/api/auth/github/callback';
    const scope = 'read:user user:email repo admin:repo_hook';
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${encodeURIComponent(scope)}`;

    // Nếu request yêu cầu JSON (ví dụ frontend gọi để lấy link)
    if (req.headers.accept?.includes('application/json')) {
      res.json({ url: githubAuthUrl });
      return;
    }

    res.redirect(githubAuthUrl);
  }

  /**
   * GET /api/auth/github/callback
   * Tiếp nhận callback code từ GitHub, đổi lấy token, lấy profile và tạo session JWT
   */
  static async githubCallback(req: Request, res: Response): Promise<void> {
    const { code } = req.query;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

    if (!code || typeof code !== 'string') {
      res.redirect(`${clientUrl}/login?error=missing_code`);
      return;
    }

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      res.redirect(`${clientUrl}/login?error=oauth_not_configured`);
      return;
    }

    try {
      // 1. Gửi request đổi code lấy access_token từ GitHub
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description || 'Không thể lấy GitHub access token');
      }

      const accessToken = tokenData.access_token;

      // 2. Lấy thông tin user profile từ GitHub
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'CodeLens-AI-Server',
        },
      });

      const gitHubUser = (await userResponse.json()) as {
        id: number;
        login: string;
        email?: string;
        avatar_url?: string;
      };

      let email = gitHubUser.email;
      if (!email) {
        // Lấy primary email nếu email profile để private
        try {
          const emailResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'User-Agent': 'CodeLens-AI-Server',
            },
          });
          const emails = (await emailResponse.json()) as Array<{ email: string; primary: boolean }>;
          const primaryEmailObj = emails.find((e) => e.primary);
          if (primaryEmailObj) {
            email = primaryEmailObj.email;
          }
        } catch {
          // Bỏ qua nếu không lấy được email phụ
        }
      }

      // 3. Mã hóa token GitHub bằng AES-256
      const encryptedToken = encryptToken(accessToken);

      // 4. Lưu / Cập nhật User trong MongoDB
      let user = await UserModel.findOne({ githubId: String(gitHubUser.id) });
      if (!user) {
        user = await UserModel.create({
          githubId: String(gitHubUser.id),
          username: gitHubUser.login,
          email,
          avatarUrl: gitHubUser.avatar_url,
          encryptedGithubToken: encryptedToken,
          role: 'DEVELOPER',
          quota: {
            dailyReposLeft: 3,
            dailyQueriesLeft: 20,
            lastResetAt: new Date(),
          },
        });
      } else {
        user.username = gitHubUser.login;
        if (email) user.email = email;
        if (gitHubUser.avatar_url) user.avatarUrl = gitHubUser.avatar_url;
        user.encryptedGithubToken = encryptedToken;
        checkAndResetUserQuota(user);
        await user.save();
      }

      // 5. Sinh JWT Token & Điều hướng về Frontend
      const jwtToken = generateAuthToken(user);
      res.redirect(`${clientUrl}/auth/callback?token=${jwtToken}`);
    } catch (error: any) {
      console.error('❌ [AuthController.githubCallback] Lỗi xác thực GitHub OAuth:', error);
      res.redirect(`${clientUrl}/login?error=${encodeURIComponent(error.message || 'oauth_failed')}`);
    }
  }

  /**
   * POST /api/auth/demo-login
   * Đăng nhập nhanh 1-click bằng tài khoản Demo Developer cho Nhà tuyển dụng/HR trải nghiệm ngay
   */
  static async demoLogin(_req: Request, res: Response): Promise<void> {
    try {
      const demoGithubId = 'demo-developer-id';
      let user = await UserModel.findOne({ githubId: demoGithubId });

      if (!user) {
        user = await UserModel.create({
          githubId: demoGithubId,
          username: 'Demo Developer (HR Preview)',
          email: 'demo-developer@codelens.ai',
          avatarUrl: 'https://avatars.githubusercontent.com/u/583231?v=4',
          encryptedGithubToken: encryptToken(process.env.GITHUB_TOKEN || 'ghp_demo_placeholder_token'),
          role: 'DEVELOPER',
          quota: {
            dailyReposLeft: 3,
            dailyQueriesLeft: 20,
            lastResetAt: new Date(),
          },
        });
      } else {
        // Tự động hồi phục quota cho phiên demo nếu đã hết
        const wasReset = checkAndResetUserQuota(user);
        if (wasReset || user.quota.dailyReposLeft <= 0 || user.quota.dailyQueriesLeft <= 0) {
          user.quota.dailyReposLeft = 3;
          user.quota.dailyQueriesLeft = 20;
          user.quota.lastResetAt = new Date();
          await user.save();
        }
      }

      const token = generateAuthToken(user);
      res.json({
        message: 'Đăng nhập Demo Developer thành công!',
        token,
        user: AuthController.formatUserProfile(user),
      });
    } catch (error: any) {
      console.error('❌ [AuthController.demoLogin] Error:', error);
      res.status(500).json({ message: error.message || 'Lỗi đăng nhập tài khoản Demo' });
    }
  }

  /**
   * GET /api/auth/me
   * Lấy thông tin user hiện tại kèm hạn mức quota
   */
  static async getMe(req: Request, res: Response): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ message: 'Chưa đăng nhập' });
        return;
      }

      // Đảm bảo quota luôn được làm mới nếu qua ngày mới
      const wasReset = checkAndResetUserQuota(user);
      if (wasReset) {
        await user.save();
      }

      res.json({
        user: AuthController.formatUserProfile(user),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Lỗi lấy thông tin tài khoản' });
    }
  }
}

