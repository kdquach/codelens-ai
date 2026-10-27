// apps/server/src/middlewares/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel, IUser, checkAndResetUserQuota } from '../models/user.model';

const JWT_SECRET = process.env.JWT_SECRET || 'codelens-jwt-secret-key-2026';
const JWT_EXPIRES_IN = '7d';

export interface AuthJwtPayload {
  userId: string;
  githubId: string;
  role: string;
}

// Mở rộng kiểu dữ liệu Request của Express để lưu user đã xác thực
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

/**
 * Sinh JWT token cho user
 */
export function generateAuthToken(user: IUser): string {
  const payload: AuthJwtPayload = {
    userId: user._id.toString(),
    githubId: user.githubId,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Middleware bắt buộc xác thực (Protected Routes)
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Vui lòng đăng nhập để thực hiện thao tác này.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthJwtPayload;
    const user = await UserModel.findById(decoded.userId);
    if (!user) {
      res.status(401).json({ message: 'Tài khoản không tồn tại hoặc phiên đăng nhập đã hết hạn.' });
      return;
    }

    // Tự động kiểm tra và reset quota nếu sang ngày mới
    const wasReset = checkAndResetUserQuota(user);
    if (wasReset) {
      await user.save();
    }

    req.user = user;
    next();
  } catch (error: any) {
    res.status(401).json({ message: 'Phiên xác thực không hợp lệ.', error: error.message });
  }
}

/**
 * Middleware tùy chọn xác thực (Gắn user nếu có token hợp lệ, không chặn nếu là Guest)
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthJwtPayload;
    const user = await UserModel.findById(decoded.userId);
    if (user) {
      const wasReset = checkAndResetUserQuota(user);
      if (wasReset) {
        await user.save();
      }
      req.user = user;
    }
  } catch {
    // Bỏ qua lỗi nếu token không hợp lệ đối với optionalAuth
  }

  next();
}

