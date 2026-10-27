// apps/server/src/models/user.model.ts
import mongoose, { Schema, Document } from 'mongoose';
import { UserRole } from '@codelens/shared';

export interface IUserQuota {
  dailyReposLeft: number;
  dailyQueriesLeft: number;
  lastResetAt: Date;
}

export interface IUser extends Document {
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  encryptedGithubToken?: string;
  role: UserRole;
  quota: IUserQuota;
  createdAt: Date;
  updatedAt: Date;
}

const UserQuotaSchema = new Schema<IUserQuota>(
  {
    dailyReposLeft: { type: Number, default: 3 },
    dailyQueriesLeft: { type: Number, default: 20 },
    lastResetAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    githubId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    email: { type: String },
    avatarUrl: { type: String },
    encryptedGithubToken: { type: String },
    role: {
      type: String,
      enum: ['GUEST', 'DEVELOPER', 'ADMIN'],
      default: 'DEVELOPER',
    },
    quota: {
      type: UserQuotaSchema,
      default: () => ({
        dailyReposLeft: 3,
        dailyQueriesLeft: 20,
        lastResetAt: new Date(),
      }),
    },
  },
  { timestamps: true }
);

/**
 * Kiểm tra và tự động thiết lập lại hạn mức (Quota) nếu đã bước sang ngày mới
 */
export function checkAndResetUserQuota(user: IUser): boolean {
  const now = new Date();
  const lastReset = user.quota?.lastResetAt ? new Date(user.quota.lastResetAt) : new Date(0);

  // So sánh ngày theo UTC/Calendar day
  const isDifferentDay =
    now.getUTCFullYear() !== lastReset.getUTCFullYear() ||
    now.getUTCMonth() !== lastReset.getUTCMonth() ||
    now.getUTCDate() !== lastReset.getUTCDate();

  if (isDifferentDay) {
    user.quota = {
      dailyReposLeft: 3,
      dailyQueriesLeft: 20,
      lastResetAt: now,
    };
    return true;
  }

  return false;
}

export const UserModel = mongoose.model<IUser>('User', UserSchema);

