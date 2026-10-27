'use client';

import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { SyncOutlined, ApartmentOutlined } from '@ant-design/icons';
import { Space } from 'antd';
import SequenceDiagramViewer from './SequenceDiagramViewer';

interface MermaidDiagramProps {
  code: string;
  isDarkMode?: boolean;
  isStreaming?: boolean;
}

/**
 * Chuẩn hóa và sửa các lỗi cú pháp Mermaid thường gặp từ mô hình ngôn ngữ lớn (LLM)
 */
function sanitizeMermaidCode(raw: string): string {
  let cleaned = (raw || '').trim();

  // Bỏ các ký tự rác hoặc khối markdown bao quanh nếu có
  cleaned = cleaned.replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();

  // Chuẩn hóa từng dòng
  const lines = cleaned.split('\n');
  const validLines: string[] = [];

  for (let line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    // Sửa lỗi: "Note over Actor," -> "Note over Actor" (trailing comma)
    trimmed = trimmed.replace(/^Note\s+over\s+([^,:]+),\s*$/i, 'Note over $1');

    // Bỏ qua dòng bị đứt quãng khi đang stream: mũi tên trơ trọi ở cuối dòng
    if (/(-->>|->>|--\)|-\))\s*$/.test(trimmed)) {
      continue;
    }

    validLines.push(trimmed);
  }

  return validLines.join('\n');
}

export default function MermaidDiagram({ code, isDarkMode, isStreaming }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [renderError, setRenderError] = useState<boolean>(false);

  useEffect(() => {
    // 1. Dọn dẹp triệt để bất kỳ thẻ lỗi nào mà Mermaid tự ý chèn vào document.body
    if (typeof document !== 'undefined') {
      const errorDivs = document.querySelectorAll('div[id^="dmermaid"]');
      errorDivs.forEach((el) => el.remove());
    }

    // 2. Nếu tin nhắn AI vẫn đang streaming, không render vội để tránh lỗi cú pháp từng phần
    if (isStreaming) {
      return;
    }

    let isCancelled = false;

    const renderMermaid = async () => {
      const sanitized = sanitizeMermaidCode(code);
      if (!sanitized) return;

      try {
        // Cấu hình Mermaid chặn hoàn toàn việc hiển thị thẻ lỗi lên DOM
        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: isDarkMode ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          sequence: {
            showSequenceNumbers: true,
            actorMargin: 40,
          },
        });

        // Ghi đè hàm parseError của Mermaid để triệt tiêu mọi thông báo lỗi ngoài ý muốn
        mermaid.parseError = () => {
          // Không làm gì để không chèn div lỗi vào document.body
        };

        const uniqueId = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(uniqueId, sanitized);

        if (!isCancelled) {
          setSvgContent(svg);
          setRenderError(false);
        }
      } catch {
        if (!isCancelled) {
          setRenderError(true);
        }
      } finally {
        // Dọn dẹp lại sau khi render
        if (typeof document !== 'undefined') {
          const errorDivs = document.querySelectorAll('div[id^="dmermaid"]');
          errorDivs.forEach((el) => el.remove());
        }
      }
    };

    renderMermaid();

    return () => {
      isCancelled = true;
      if (typeof document !== 'undefined') {
        const errorDivs = document.querySelectorAll('div[id^="dmermaid"]');
        errorDivs.forEach((el) => el.remove());
      }
    };
  }, [code, isDarkMode, isStreaming]);

  // Khi đang stream: Hiển thị placeholder nhẹ nhàng, không parse vội
  if (isStreaming) {
    return (
      <div
        style={{
          margin: '12px 0',
          padding: '12px 16px',
          borderRadius: 8,
          background: isDarkMode ? '#0f172a' : '#f8fafc',
          border: `1px dashed ${isDarkMode ? '#334155' : '#cbd5e1'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <SyncOutlined spin style={{ color: '#38bdf8' }} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Đang tạo sơ đồ tuần tự (Sequence Diagram)...</span>
      </div>
    );
  }

  // Nếu Mermaid gặp lỗi cú pháp do LLM: Tự động kích hoạt Bộ vẽ SequenceDiagramViewer (luôn hiển thị biểu đồ 100%)
  if (renderError || !svgContent) {
    return <SequenceDiagramViewer code={code} isDarkMode={isDarkMode} />;
  }

  return (
    <div
      ref={containerRef}
      style={{
        margin: '14px 0',
        padding: '14px',
        borderRadius: 8,
        background: isDarkMode ? '#0f172a' : '#f8fafc',
        border: isDarkMode ? '1px solid #1e293b' : '1px solid #e2e8f0',
        overflowX: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        boxShadow: isDarkMode ? '0 2px 8px rgba(0, 0, 0, 0.25)' : '0 1px 4px rgba(0, 0, 0, 0.05)',
      }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
}
