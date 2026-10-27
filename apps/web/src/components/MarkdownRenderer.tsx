'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidDiagram from './MermaidDiagram';
import { Tag, Tooltip, Typography } from 'antd';
import { CodeOutlined, CopyOutlined, CheckOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface MarkdownRendererProps {
  content: string;
  isDarkMode?: boolean;
  isStreaming?: boolean;
  onCitationClick?: (filePath: string) => void;
}

export default function MarkdownRenderer({
  content,
  isDarkMode = true,
  isStreaming = false,
  onCitationClick,
}: MarkdownRendererProps) {
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div
      style={{
        fontSize: 13,
        lineHeight: 1.65,
        color: isDarkMode ? '#e2e8f0' : '#1e293b',
        wordBreak: 'break-word',
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 style={{ margin: '14px 0 8px', fontSize: 16, fontWeight: 700, color: isDarkMode ? '#38bdf8' : '#0284c7' }}>
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 style={{ margin: '12px 0 6px', fontSize: 15, fontWeight: 700, color: isDarkMode ? '#38bdf8' : '#0284c7' }}>
              {children}
            </h4>
          ),
          h3: ({ children }) => (
            <h5 style={{ margin: '10px 0 6px', fontSize: 14, fontWeight: 600, color: isDarkMode ? '#cbd5e1' : '#334155' }}>
              {children}
            </h5>
          ),
          p: ({ children }) => (
            <p style={{ margin: '0 0 10px', lineHeight: 1.65 }}>
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: '0 0 10px', paddingLeft: 20 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0 0 10px', paddingLeft: 20 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '4px 0' }}>{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '10px 0',
                padding: '6px 12px',
                borderLeft: `4px solid ${isDarkMode ? '#38bdf8' : '#0284c7'}`,
                background: isDarkMode ? 'rgba(56, 189, 248, 0.08)' : '#f0f9ff',
                borderRadius: '0 6px 6px 0',
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr
              style={{
                margin: '14px 0',
                border: 'none',
                borderTop: isDarkMode ? '1px solid #1e293b' : '1px solid #e2e8f0',
              }}
            />
          ),
          code(props) {
            const { children, className, node, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';
            const codeString = String(children).replace(/\n$/, '');

            // ── Khối mã Mermaid (Sequence / Flowchart Diagram) ──
            if (lang === 'mermaid') {
              return <MermaidDiagram code={codeString} isDarkMode={isDarkMode} isStreaming={isStreaming} />;
            }

            // ── Khối mã nhiều dòng (Code Block) ──
            if (match) {
              const isCopied = copiedCode === codeString;
              return (
                <div
                  style={{
                    margin: '12px 0',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: isDarkMode ? '1px solid #334155' : '1px solid #cbd5e1',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '4px 12px',
                      background: isDarkMode ? '#1e293b' : '#f1f5f9',
                      borderBottom: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0',
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>
                      {lang}
                    </Text>
                    <button
                      type="button"
                      onClick={() => handleCopy(codeString)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: isDarkMode ? '#94a3b8' : '#64748b',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {isCopied ? <CheckOutlined style={{ color: '#10b981' }} /> : <CopyOutlined />}
                      <span style={{ fontSize: 11 }}>{isCopied ? 'Đã sao chép' : 'Sao chép'}</span>
                    </button>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: isDarkMode ? '#020617' : '#f8fafc',
                      fontSize: 12,
                      lineHeight: 1.5,
                      overflowX: 'auto',
                    }}
                  >
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            }

            // ── Trích dẫn Citation (Ví dụ: [backend/src/controllers/user.ts:L30-L45]) ──
            const trimmed = codeString.trim();
            const citationMatch = trimmed.match(/^([a-zA-Z0-9_\-./]+):L(\d+)(?:-L?(\d+))?$/);
            if (citationMatch) {
              const filePath = citationMatch[1];
              const startLine = citationMatch[2];
              const endLine = citationMatch[3];
              return (
                <Tooltip title={`Bấm để chọn file "${filePath}" trên Canvas`}>
                  <Tag
                    color="blue"
                    icon={<CodeOutlined />}
                    style={{
                      cursor: 'pointer',
                      margin: '0 2px',
                      fontWeight: 500,
                      borderRadius: 4,
                    }}
                    onClick={() => onCitationClick && onCitationClick(filePath)}
                  >
                    {filePath.split('/').pop()}:L{startLine}{endLine ? `-${endLine}` : ''}
                  </Tag>
                </Tooltip>
              );
            }

            // ── Mã nội dòng (Inline Code) ──
            return (
              <code
                style={{
                  background: isDarkMode ? 'rgba(56, 189, 248, 0.12)' : 'rgba(2, 132, 199, 0.08)',
                  color: isDarkMode ? '#38bdf8' : '#0284c7',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: '0.9em',
                  fontFamily: 'monospace',
                }}
                {...rest}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
