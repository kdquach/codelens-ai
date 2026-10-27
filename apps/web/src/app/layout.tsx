import React from 'react';

export const metadata = {
  title: 'CodeLens AI - Architecture Visualizer & Code-Aware RAG',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: 'sans-serif' }}>
        {children}
      </body>
    </html>
  );
}