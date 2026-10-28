'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        localStorage.setItem('codelens_jwt_token', token);
      }
      router.replace(`/${token ? `?token=${token}` : ''}`);
    }
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 16,
        background: '#0a0d14',
        color: '#e2e8f0',
      }}
    >
      <Spin size="large" />
      <div>Đang hoàn tất đăng nhập GitHub...</div>
    </div>
  );
}

