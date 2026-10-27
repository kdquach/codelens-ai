// apps/web/src/store/useAuthStore.ts
import { create } from 'zustand';
import { UserProfile, UserQuota } from '@codelens/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const TOKEN_STORAGE_KEY = 'codelens_jwt_token';

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  initAuth: () => Promise<void>;
  loginWithDemo: () => Promise<{ success: boolean; message?: string }>;
  loginWithGithub: () => void;
  logout: () => void;
  setToken: (token: string) => Promise<void>;
  fetchMe: () => Promise<void>;
  updateQuota: (quota: Partial<UserQuota>) => void;
  decrementRepoQuota: () => void;
  decrementQueryQuota: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoading: false,
  error: null,

  /**
   * Khởi tạo xác thực khi tải trang:
   * 1. Kiểm tra token trên URL query `?token=...` (trả về từ GitHub OAuth callback)
   * 2. Hoặc lấy token từ localStorage
   * 3. Gọi /api/auth/me để cập nhật Profile & Quota mới nhất
   */
  initAuth: async () => {
    if (typeof window === 'undefined') return;

    let tokenToUse: string | null = null;

    // Kiểm tra query parameter ?token= trên URL (luồng OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');

    if (urlToken) {
      tokenToUse = urlToken;
      localStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
      // Xóa query param trên URL sau khi các thành phần đã đọc thông báo
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }
      }, 800);
    } else {
      tokenToUse = localStorage.getItem(TOKEN_STORAGE_KEY);
    }

    if (!tokenToUse) {
      set({ token: null, user: null, isLoading: false });
      return;
    }

    set({ token: tokenToUse, isLoading: true });

    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${tokenToUse}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        set({ user: data.user, token: tokenToUse, isLoading: false, error: null });
      } else {
        // Token không còn hợp lệ
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        set({ token: null, user: null, isLoading: false });
      }
    } catch (err: any) {
      console.warn('⚠️ [useAuthStore.initAuth] Lỗi lấy thông tin me:', err.message);
      set({ isLoading: false });
    }
  },

  /**
   * Đăng nhập 1-Click bằng tài khoản Demo Developer
   */
  loginWithDemo: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/auth/demo-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Đăng nhập Demo thất bại');
      }

      const data = await res.json();
      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      }

      set({
        token: data.token,
        user: data.user,
        isLoading: false,
        error: null,
      });

      return { success: true, message: data.message };
    } catch (err: any) {
      console.error('❌ [useAuthStore.loginWithDemo] Error:', err);
      set({ isLoading: false, error: err.message });
      return { success: false, message: err.message };
    }
  },

  /**
   * Chuyển hướng sang GitHub OAuth Login
   */
  loginWithGithub: () => {
    if (typeof window !== 'undefined') {
      window.location.href = `${API_URL}/auth/github`;
    }
  },

  /**
   * Đăng xuất tài khoản
   */
  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    set({ token: null, user: null, error: null });
  },

  /**
   * Thiết lập token thủ công và đồng bộ profile
   */
  setToken: async (token: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
    set({ token });
    await get().fetchMe();
  },

  /**
   * Gọi GET /api/auth/me để cập nhật profile & quota mới nhất
   */
  fetchMe: async () => {
    const { token } = get();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        set({ user: data.user });
      }
    } catch (err: any) {
      console.warn('⚠️ [useAuthStore.fetchMe] Error:', err.message);
    }
  },

  /**
   * Cập nhật hạn mức Quota theo thời gian thực
   */
  updateQuota: (newQuota: Partial<UserQuota>) => {
    const { user } = get();
    if (!user) return;

    set({
      user: {
        ...user,
        quota: {
          ...user.quota,
          ...newQuota,
        },
      },
    });
  },

  /**
   * Giảm 1 đơn vị repo quota khi nạp thành công
   */
  decrementRepoQuota: () => {
    const { user } = get();
    if (!user) return;

    const currentLeft = user.quota?.dailyReposLeft ?? 3;
    set({
      user: {
        ...user,
        quota: {
          ...user.quota,
          dailyReposLeft: Math.max(0, currentLeft - 1),
        },
      },
    });
  },

  /**
   * Giảm 1 đơn vị query quota khi gửi câu hỏi
   */
  decrementQueryQuota: () => {
    const { user } = get();
    if (!user) return;

    const currentLeft = user.quota?.dailyQueriesLeft ?? 20;
    set({
      user: {
        ...user,
        quota: {
          ...user.quota,
          dailyQueriesLeft: Math.max(0, currentLeft - 1),
        },
      },
    });
  },
}));

