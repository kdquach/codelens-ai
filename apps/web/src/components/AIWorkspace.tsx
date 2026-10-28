'use client';

import React, { useState, useRef } from 'react';
import {
  Button,
  Space,
  Tag,
  Typography,
  Empty,
  Spin,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  RobotOutlined,
  ApartmentOutlined,
  FileTextOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  CompressOutlined,
  ExpandAltOutlined,
  SyncOutlined,
  AimOutlined,
} from '@ant-design/icons';
import MermaidDiagram from './MermaidDiagram';
import MarkdownRenderer from './MarkdownRenderer';
import type { ChatMessage } from '../app/page';

const { Text, Title } = Typography;

export type WorkspaceTab = 'diagram' | 'explanation';

interface AIWorkspaceProps {
  message: ChatMessage | null;
  mermaidCode: string | null;
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  onClose: () => void;
  repoName?: string;
  isDarkMode: boolean;
  cardBg: string;
  cardBorder: string;
  onCitationClick?: (filePath: string) => void;
  onAskForDiagram?: (type?: 'flowchart' | 'sequence' | 'erd' | 'architecture') => void;
}

export default function AIWorkspace({
  message,
  mermaidCode,
  activeTab,
  onTabChange,
  onClose,
  repoName,
  isDarkMode,
  cardBg,
  cardBorder,
  onCitationClick,
  onAskForDiagram,
}: AIWorkspaceProps) {
  const [diagramScale, setDiagramScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const diagramContainerRef = useRef<HTMLDivElement>(null);

  const bgMain = isDarkMode ? '#0a0d14' : '#f8fafc';
  const headingColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const subtleText = isDarkMode ? '#94a3b8' : '#64748b';
  const activeTabBg = isDarkMode ? '#1e293b' : '#ffffff';
  const inactiveTabBg = 'transparent';
  const activeTabColor = isDarkMode ? '#38bdf8' : '#2563eb';
  const inactiveTabColor = subtleText;

  const zoomIn = () => setDiagramScale((s) => Math.min(s + 0.2, 3));
  const zoomOut = () => setDiagramScale((s) => Math.max(s - 0.2, 0.3));
  const resetZoom = () => setDiagramScale(1);
  const fitToView = () => {
    setDiagramScale(1);
    if (diagramContainerRef.current) {
      diagramContainerRef.current.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      diagramContainerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const isStreaming = message?.isStreaming ?? false;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        background: bgMain,
      }}
    >
      {/* ── Workspace Header ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 20px',
          background: cardBg,
          borderBottom: `1px solid ${cardBorder}`,
          gap: 12,
          flexWrap: 'wrap',
          boxSizing: 'border-box',
        }}
      >
        {/* Left: back + title */}
        <Space size={12} align="center">
          <Tooltip title="Quay lại bản đồ AST">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onClose}
              style={{
                fontWeight: 500,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              Quay lại
            </Button>
          </Tooltip>

          <div
            style={{
              width: 1,
              height: 20,
              background: cardBorder,
            }}
          />

          <Space size={8} align="center">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(135deg, rgba(56,189,248,0.2), rgba(124,58,237,0.2))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              <RobotOutlined />
            </div>
            <div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: headingColor,
                  lineHeight: 1.2,
                }}
              >
                AI Analysis Workspace
              </div>
              {repoName && (
                <div style={{ fontSize: 11, color: subtleText, marginTop: 1 }}>
                  {repoName}
                </div>
              )}
            </div>
          </Space>

          {isStreaming && (
            <Tag
              icon={<SyncOutlined spin />}
              color="processing"
              style={{ fontSize: 11, marginLeft: 4 }}
            >
              Đang phân tích...
            </Tag>
          )}
        </Space>

        {/* Right: Tab switcher */}
        <Space size={4}>
          <button
            type="button"
            onClick={() => onTabChange('diagram')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${activeTab === 'diagram' ? activeTabColor : cardBorder}`,
              background: activeTab === 'diagram' ? activeTabBg : inactiveTabBg,
              color: activeTab === 'diagram' ? activeTabColor : inactiveTabColor,
              fontWeight: activeTab === 'diagram' ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <ApartmentOutlined />
            Biểu đồ
            {mermaidCode && !isStreaming && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: activeTab === 'diagram' ? activeTabColor : '#10b981',
                  color: '#ffffff',
                  fontSize: 9,
                  fontWeight: 700,
                  marginLeft: 2,
                }}
              >
                ✓
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('explanation')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${activeTab === 'explanation' ? activeTabColor : cardBorder}`,
              background: activeTab === 'explanation' ? activeTabBg : inactiveTabBg,
              color: activeTab === 'explanation' ? activeTabColor : inactiveTabColor,
              fontWeight: activeTab === 'explanation' ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <FileTextOutlined />
            Giải thích
          </button>
        </Space>
      </div>

      {/* ── Tab Content Area ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Tab: Biểu đồ ── */}
        <div
          style={{
            display: activeTab === 'diagram' ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {/* Diagram Toolbar */}
          {mermaidCode && !isStreaming && (
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 20px',
                background: isDarkMode ? '#0f172a' : '#f1f5f9',
                borderBottom: `1px solid ${cardBorder}`,
              }}
            >
              <Text style={{ fontSize: 12, color: subtleText }}>
                Sơ đồ kiến trúc — Cuộn hoặc kéo để điều hướng
              </Text>
              <Space size={4}>
                <Tooltip title="Thu nhỏ (-)">
                  <Button
                    size="small"
                    type="text"
                    icon={<ZoomOutOutlined />}
                    onClick={zoomOut}
                    disabled={diagramScale <= 0.3}
                    style={{ color: subtleText }}
                  />
                </Tooltip>
                <button
                  type="button"
                  onClick={resetZoom}
                  style={{
                    padding: '2px 10px',
                    borderRadius: 6,
                    border: `1px solid ${cardBorder}`,
                    background: cardBg,
                    color: subtleText,
                    fontSize: 12,
                    cursor: 'pointer',
                    minWidth: 52,
                    fontWeight: 500,
                  }}
                >
                  {Math.round(diagramScale * 100)}%
                </button>
                <Tooltip title="Phóng to (+)">
                  <Button
                    size="small"
                    type="text"
                    icon={<ZoomInOutlined />}
                    onClick={zoomIn}
                    disabled={diagramScale >= 3}
                    style={{ color: subtleText }}
                  />
                </Tooltip>
                <Tooltip title="Căn vừa màn hình (Fit-to-view)">
                  <Button
                    size="small"
                    type="text"
                    icon={<AimOutlined />}
                    onClick={fitToView}
                    style={{ color: subtleText }}
                  />
                </Tooltip>
                <div style={{ width: 1, height: 16, background: cardBorder, margin: '0 4px' }} />
                <Tooltip title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}>
                  <Button
                    size="small"
                    type="text"
                    icon={isFullscreen ? <CompressOutlined /> : <ExpandAltOutlined />}
                    onClick={toggleFullscreen}
                    style={{ color: subtleText }}
                  />
                </Tooltip>
              </Space>
            </div>
          )}

          {/* Diagram Canvas */}
          <div
            ref={diagramContainerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              background: isDarkMode ? '#020617' : '#f8fafc',
              padding: 24,
              display: 'flex',
              alignItems: mermaidCode ? 'flex-start' : 'center',
              justifyContent: mermaidCode ? 'flex-start' : 'center',
            }}
          >
            {isStreaming ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  color: subtleText,
                  margin: 'auto',
                }}
              >
                <Spin size="large" />
                <Text style={{ color: subtleText, fontSize: 13 }}>
                  AI đang tạo biểu đồ...
                </Text>
              </div>
            ) : mermaidCode ? (
              <div
                style={{
                  width: '100%',
                  ...(mermaidCode.trim().startsWith('flowchart') || mermaidCode.trim().startsWith('graph')
                    ? { minHeight: 520, height: '100%' }
                    : {
                        transformOrigin: 'top left',
                        transform: `scale(${diagramScale})`,
                        transition: 'transform 0.2s ease',
                        minWidth: 'max-content',
                      }),
                }}
              >
                <MermaidDiagram
                  code={mermaidCode}
                  isDarkMode={isDarkMode}
                  isStreaming={false}
                />
              </div>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <div style={{ textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>
                    <Text style={{ color: subtleText, fontSize: 13, display: 'block', fontWeight: 600 }}>
                      Chưa có biểu đồ cho ngữ cảnh này
                    </Text>
                    <Text style={{ color: isDarkMode ? '#475569' : '#94a3b8', fontSize: 12, display: 'block', marginTop: 4 }}>
                      Chọn một loại biểu đồ bên dưới để AI tự động phân tích và phác thảo theo ý muốn:
                    </Text>
                    {onAskForDiagram && (
                      <div
                        style={{
                          marginTop: 16,
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 10,
                          textAlign: 'left',
                        }}
                      >
                        <Button
                          type="dashed"
                          size="middle"
                          icon={<ApartmentOutlined style={{ color: '#06b6d4' }} />}
                          onClick={() => onAskForDiagram('flowchart')}
                          style={{ borderRadius: 8, fontSize: 12, height: 'auto', padding: '10px 12px' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>Flowchart (Tương tác)</div>
                            <div style={{ fontSize: 10, color: subtleText }}>Kéo thả luồng xử lý</div>
                          </div>
                        </Button>
                        <Button
                          type="dashed"
                          size="middle"
                          icon={<ApartmentOutlined style={{ color: '#38bdf8' }} />}
                          onClick={() => onAskForDiagram('sequence')}
                          style={{ borderRadius: 8, fontSize: 12, height: 'auto', padding: '10px 12px' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>Sequence Diagram</div>
                            <div style={{ fontSize: 10, color: subtleText }}>Thứ tự gọi API & hàm</div>
                          </div>
                        </Button>
                        <Button
                          type="dashed"
                          size="middle"
                          icon={<ApartmentOutlined style={{ color: '#10b981' }} />}
                          onClick={() => onAskForDiagram('architecture')}
                          style={{ borderRadius: 8, fontSize: 12, height: 'auto', padding: '10px 12px' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>Kiến trúc phân tầng</div>
                            <div style={{ fontSize: 10, color: subtleText }}>C4 System / Module</div>
                          </div>
                        </Button>
                        <Button
                          type="dashed"
                          size="middle"
                          icon={<ApartmentOutlined style={{ color: '#f59e0b' }} />}
                          onClick={() => onAskForDiagram('erd')}
                          style={{ borderRadius: 8, fontSize: 12, height: 'auto', padding: '10px 12px' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>Mô hình dữ liệu (ERD)</div>
                            <div style={{ fontSize: 10, color: subtleText }}>Quan hệ Entity & DB</div>
                          </div>
                        </Button>
                      </div>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </div>

        {/* ── Tab: Giải thích ── */}
        <div
          style={{
            display: activeTab === 'explanation' ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '20px 28px',
              background: bgMain,
              boxSizing: 'border-box',
            }}
          >
            {!message ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <Text style={{ color: subtleText, fontSize: 13 }}>
                      Chưa có phân tích nào. Hãy đặt câu hỏi trong chat AI.
                    </Text>
                  }
                />
              </div>
            ) : isStreaming && !message.text ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  paddingTop: 60,
                  color: subtleText,
                }}
              >
                <Spin size="large" />
                <Text style={{ color: subtleText, fontSize: 13 }}>
                  AI đang phân tích...
                </Text>
              </div>
            ) : (
              <div
                style={{
                  maxWidth: 900,
                  width: '100%',
                  minWidth: 0,
                  margin: '0 auto',
                  boxSizing: 'border-box',
                }}
              >
                {/* Message metadata */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 20,
                    paddingBottom: 16,
                    borderBottom: `1px solid ${cardBorder}`,
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: isDarkMode ? '#1e293b' : '#e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#38bdf8',
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    <RobotOutlined />
                  </div>
                  <Space size={8}>
                    <Text strong style={{ fontSize: 13, color: headingColor }}>
                      AI Code Architect
                    </Text>
                    <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>
                      AST &amp; Graph
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {message.timestamp}
                    </Text>
                    {isStreaming && (
                      <Tag
                        icon={<SyncOutlined spin />}
                        color="processing"
                        style={{ fontSize: 10, margin: 0 }}
                      >
                        Đang viết...
                      </Tag>
                    )}
                  </Space>
                </div>

                {/* Full AI response */}
                <MarkdownRenderer
                  content={message.text}
                  isDarkMode={isDarkMode}
                  isStreaming={isStreaming}
                  onCitationClick={onCitationClick}
                />

                {/* Citations */}
                {message.citations && message.citations.length > 0 && (
                  <div
                    style={{
                      marginTop: 20,
                      paddingTop: 16,
                      borderTop: `1px dashed ${cardBorder}`,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                      Trích dẫn nguồn AST:
                    </Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {message.citations.map((c, i) => (
                        <Tag
                          key={i}
                          color="cyan"
                          style={{ cursor: 'pointer', fontSize: 11 }}
                          onClick={() => onCitationClick?.(c.filePath)}
                        >
                          {c.filePath}:L{c.startLine}-L{c.endLine}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

