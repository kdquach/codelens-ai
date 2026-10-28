import React from 'react';

export const metadata = {
  title: 'CodeLens AI - Architecture Visualizer & Code-Aware RAG',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" style={{ height: '100%', overflow: 'hidden' }}>
      <body style={{ margin: 0, fontFamily: 'sans-serif', height: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
        {children}
      </body>
    </html>
  );
}