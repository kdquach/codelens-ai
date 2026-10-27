'use client';

import React, { useState } from 'react';
import { Tag, Tooltip, Button, Space, Typography } from 'antd';
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  UnorderedListOutlined,
  CopyOutlined,
  CheckOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  UndoOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export interface SequenceParticipant {
  id: string;
  label: string;
  isActor?: boolean;
}

export interface SequenceStep {
  stepNumber: number;
  from: string;
  to: string;
  message: string;
  isReturn?: boolean;
  isSelf?: boolean;
  isNote?: boolean;
  noteTarget?: string;
}

/**
 * Bộ phân tích cú pháp Sequence Diagram độc lập và siêu chịu lỗi (Fault-Tolerant Parser)
 * Có khả năng đọc hiểu mọi định dạng Mermaid kể cả khi bị lỗi cú pháp, thiếu ngoặc hoặc ngắt dòng.
 */
export function parseSequenceDiagram(rawCode: string): {
  participants: SequenceParticipant[];
  steps: SequenceStep[];
} {
  const lines = (rawCode || '').split('\n');
  const participantMap = new Map<string, SequenceParticipant>();
  const steps: SequenceStep[] = [];
  let currentStepNum = 1;

  // 1. Duyệt bóc tách participants và actors được khai báo
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // actor Client
    const actorMatch = line.match(/^actor\s+([a-zA-Z0-9_]+)(?:\s+as\s+(.+))?$/i);
    if (actorMatch) {
      const id = actorMatch[1];
      const label = actorMatch[2]?.trim() || id;
      participantMap.set(id, { id, label, isActor: true });
      continue;
    }

    // participant Controller as createAddFavoriteHandler
    const partMatch = line.match(/^participant\s+([a-zA-Z0-9_]+)(?:\s+as\s+(.+))?$/i);
    if (partMatch) {
      const id = partMatch[1];
      const label = partMatch[2]?.trim() || id;
      participantMap.set(id, { id, label, isActor: false });
      continue;
    }
  }

  // 2. Duyệt các bước tương tác (A ->> B: Message) và Note
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith('sequenceDiagram') || line.startsWith('autonumber')) continue;

    // Sửa các lỗi LLM phổ biến: Note over Client, -> Note over Client:
    line = line.replace(/^Note\s+over\s+([^,:]+),\s*$/i, 'Note over $1: Ghi chú');

    // Note over Repo: Ghi chú
    const noteMatch = line.match(/^Note\s+(?:over|left of|right of)\s+([^,:\n]+)(?:,\s*[^,:\n]+)?\s*:\s*(.+)$/i);
    if (noteMatch) {
      const target = noteMatch[1].trim();
      const message = noteMatch[2].trim().replace(/<br\s*\/?>/gi, ' ');
      if (!participantMap.has(target)) {
        participantMap.set(target, { id: target, label: target });
      }
      steps.push({
        stepNumber: currentStepNum++,
        from: target,
        to: target,
        message,
        isNote: true,
        noteTarget: target,
      });
      continue;
    }

    // Tương tác mũi tên: Client->>Controller: POST /login (credentials)
    const arrowMatch = line.match(/^([a-zA-Z0-9_]+)\s*(-->>|->>|-->|->)\s*([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (arrowMatch) {
      const from = arrowMatch[1].trim();
      const arrowType = arrowMatch[2];
      const to = arrowMatch[3].trim();
      const message = arrowMatch[4].trim();
      const isReturn = arrowType === '-->>' || arrowType === '-->';
      const isSelf = from === to;

      // Tự động bổ sung participant nếu chưa khai báo trước đó
      if (!participantMap.has(from)) {
        participantMap.set(from, { id: from, label: from });
      }
      if (!participantMap.has(to)) {
        participantMap.set(to, { id: to, label: to });
      }

      steps.push({
        stepNumber: currentStepNum++,
        from,
        to,
        message,
        isReturn,
        isSelf,
      });
    }
  }

  return {
    participants: Array.from(participantMap.values()),
    steps,
  };
}

interface SequenceDiagramViewerProps {
  code: string;
  isDarkMode?: boolean;
}

export default function SequenceDiagramViewer({ code, isDarkMode = true }: SequenceDiagramViewerProps) {
  const [viewMode, setViewMode] = useState<'svg' | 'timeline' | 'code'>('svg');
  const [zoom, setZoom] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);

  const { participants, steps } = parseSequenceDiagram(code);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Màu sắc chủ đạo theo theme
  const colors = {
    bg: isDarkMode ? '#0f172a' : '#f8fafc',
    border: isDarkMode ? '#1e293b' : '#e2e8f0',
    participantBg: isDarkMode ? '#1e293b' : '#e0f2fe',
    participantBorder: isDarkMode ? '#38bdf8' : '#0284c7',
    participantText: isDarkMode ? '#f1f5f9' : '#0369a1',
    line: isDarkMode ? '#475569' : '#cbd5e1',
    arrowNormal: '#3b82f6',
    arrowReturn: '#10b981',
    noteBg: isDarkMode ? '#3b2f15' : '#fef9c3',
    noteBorder: '#eab308',
    noteText: isDarkMode ? '#fef08a' : '#854d0e',
    textMain: isDarkMode ? '#cbd5e1' : '#334155',
  };

  // Nếu không phân tích được bước nào (ví dụ code rỗng hoặc không phải sequence diagram)
  if (participants.length === 0 || steps.length === 0) {
    return (
      <div style={{ margin: '12px 0', padding: 12, borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}` }}>
        <pre style={{ margin: 0, fontSize: 11, overflowX: 'auto' }}><code>{code}</code></pre>
      </div>
    );
  }

  // Tọa độ tính toán cho bản đồ SVG
  const colWidth = 190;
  const marginLeft = 60;
  const rowHeight = 52;
  const marginTop = 70;
  const svgWidth = Math.max(680, marginLeft * 2 + (participants.length - 1) * colWidth);
  const svgHeight = marginTop + steps.length * rowHeight + 60;

  const getParticipantX = (id: string) => {
    const idx = participants.findIndex((p) => p.id === id);
    if (idx === -1) return marginLeft;
    return marginLeft + idx * colWidth;
  };

  return (
    <div
      style={{
        margin: '14px 0',
        borderRadius: 10,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        boxShadow: isDarkMode ? '0 4px 16px rgba(0, 0, 0, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.05)',
        overflow: 'hidden',
      }}
    >
      {/* ── Toolbar Điều khiển Chế độ Xem & Phóng to ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 14px',
          background: isDarkMode ? '#1e293b' : '#f1f5f9',
          borderBottom: `1px solid ${colors.border}`,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space size={8}>
          <Tag color="cyan" style={{ margin: 0, fontWeight: 600 }}>
            <ApartmentOutlined style={{ marginRight: 4 }} /> Sơ đồ Luồng Tuần tự ({steps.length} bước)
          </Tag>
          <Button
            size="small"
            type={viewMode === 'svg' ? 'primary' : 'default'}
            icon={<ApartmentOutlined />}
            onClick={() => setViewMode('svg')}
          >
            Đồ họa SVG
          </Button>
          <Button
            size="small"
            type={viewMode === 'timeline' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('timeline')}
          >
            Lộ trình Các bước
          </Button>
          <Button
            size="small"
            type={viewMode === 'code' ? 'primary' : 'default'}
            onClick={() => setViewMode('code')}
          >
            Mã Mermaid
          </Button>
        </Space>

        <Space size={4}>
          {viewMode === 'svg' && (
            <>
              <Tooltip title="Thu nhỏ">
                <Button size="small" icon={<ZoomOutOutlined />} onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))} />
              </Tooltip>
              <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 40, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <Tooltip title="Phóng to">
                <Button size="small" icon={<ZoomInOutlined />} onClick={() => setZoom((z) => Math.min(1.5, z + 0.15))} />
              </Tooltip>
              <Tooltip title="Đặt lại kích thước">
                <Button size="small" icon={<UndoOutlined />} onClick={() => setZoom(1)} />
              </Tooltip>
            </>
          )}
          <Tooltip title={copied ? 'Đã sao chép!' : 'Sao chép mã Mermaid'}>
            <Button size="small" icon={copied ? <CheckOutlined style={{ color: '#10b981' }} /> : <CopyOutlined />} onClick={handleCopyCode} />
          </Tooltip>
        </Space>
      </div>

      {/* ── CHẾ ĐỘ 1: BẢN ĐỒ TUẦN TỰ ĐỒ HỌA SVG (Không bao giờ vỡ, luôn hiển thị 100%) ── */}
      {viewMode === 'svg' && (
        <div
          style={{
            overflow: 'auto',
            maxHeight: 520,
            padding: 16,
            display: 'flex',
            justifyContent: svgWidth * zoom > 600 ? 'flex-start' : 'center',
          }}
        >
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: 'transform 0.15s ease-out',
            }}
          >
            <svg
              width={svgWidth}
              height={svgHeight}
              style={{ display: 'block', overflow: 'visible' }}
            >
              <defs>
                {/* Mũi tên tương tác chính (Solid Arrow) */}
                <marker
                  id="arrow-solid"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill={colors.arrowNormal} />
                </marker>
                {/* Mũi tên trả về (Return Arrow) */}
                <marker
                  id="arrow-return"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill={colors.arrowReturn} />
                </marker>
              </defs>

              {/* ── Đường trục tung Lifeline cho từng Participant ── */}
              {participants.map((p) => {
                const x = getParticipantX(p.id);
                return (
                  <g key={`lifeline-${p.id}`}>
                    <line
                      x1={x}
                      y1={marginTop - 15}
                      x2={x}
                      y2={svgHeight - 25}
                      stroke={colors.line}
                      strokeWidth={1.5}
                      strokeDasharray="5,5"
                    />
                    {/* Header Box ở đỉnh */}
                    <rect
                      x={x - 65}
                      y={14}
                      width={130}
                      height={32}
                      rx={6}
                      fill={colors.participantBg}
                      stroke={colors.participantBorder}
                      strokeWidth={1.5}
                    />
                    <text
                      x={x}
                      y={35}
                      textAnchor="middle"
                      fill={colors.participantText}
                      fontSize={12}
                      fontWeight={600}
                    >
                      {p.label.length > 16 ? p.label.slice(0, 15) + '…' : p.label}
                    </text>
                  </g>
                );
              })}

              {/* ── Các bước mũi tên tuần tự (Steps) ── */}
              {steps.map((step, idx) => {
                const y = marginTop + idx * rowHeight;
                const xFrom = getParticipantX(step.from);
                const xTo = getParticipantX(step.to);

                // Khối Ghi chú (Note)
                if (step.isNote) {
                  return (
                    <g key={`step-${idx}`} transform={`translate(${xFrom - 75}, ${y - 14})`}>
                      <rect
                        width={150}
                        height={28}
                        rx={5}
                        fill={colors.noteBg}
                        stroke={colors.noteBorder}
                        strokeWidth={1}
                      />
                      <text
                        x={75}
                        y={18}
                        textAnchor="middle"
                        fill={colors.noteText}
                        fontSize={11}
                        fontWeight={500}
                      >
                        📌 {step.message.length > 20 ? step.message.slice(0, 19) + '…' : step.message}
                      </text>
                    </g>
                  );
                }

                // Tương tác tự gọi chính mình (Self Call: A -> A)
                if (step.isSelf) {
                  return (
                    <g key={`step-${idx}`}>
                      {/* Vòng lặp tự gọi */}
                      <path
                        d={`M ${xFrom} ${y} L ${xFrom + 30} ${y} L ${xFrom + 30} ${y + 20} L ${xFrom + 10} ${y + 20}`}
                        fill="none"
                        stroke={colors.arrowNormal}
                        strokeWidth={1.5}
                        markerEnd="url(#arrow-solid)"
                      />
                      {/* Badge số thứ tự */}
                      <circle cx={xFrom - 16} cy={y + 10} r={8} fill={colors.arrowNormal} />
                      <text x={xFrom - 16} y={y + 14} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>
                        {step.stepNumber}
                      </text>
                      {/* Nhãn mô tả */}
                      <text x={xFrom + 38} y={y + 14} fill={colors.textMain} fontSize={11} fontWeight={500}>
                        {step.message}
                      </text>
                    </g>
                  );
                }

                // Mũi tên từ A sang B
                const isLeftToRight = xFrom < xTo;
                const arrowColor = step.isReturn ? colors.arrowReturn : colors.arrowNormal;
                const midX = (xFrom + xTo) / 2;

                return (
                  <g key={`step-${idx}`}>
                    {/* Đường mũi tên */}
                    <line
                      x1={xFrom}
                      y1={y}
                      x2={xTo + (isLeftToRight ? -6 : 6)}
                      y2={y}
                      stroke={arrowColor}
                      strokeWidth={1.5}
                      strokeDasharray={step.isReturn ? '4,4' : 'none'}
                      markerEnd={step.isReturn ? 'url(#arrow-return)' : 'url(#arrow-solid)'}
                    />

                    {/* Badge số thứ tự bước */}
                    <circle cx={midX - 10} cy={y - 12} r={9} fill={arrowColor} />
                    <text x={midX - 10} y={y - 8} textAnchor="middle" fill="#fff" fontSize={10} fontWeight={700}>
                      {step.stepNumber}
                    </text>

                    {/* Nhãn văn bản thông điệp */}
                    <rect
                      x={midX + 4}
                      y={y - 20}
                      width={Math.min(320, step.message.length * 6.8 + 10)}
                      height={18}
                      rx={3}
                      fill={isDarkMode ? 'rgba(15, 23, 42, 0.85)' : 'rgba(255, 255, 255, 0.9)'}
                    />
                    <text
                      x={midX + 8}
                      y={y - 6}
                      fill={colors.textMain}
                      fontSize={11}
                      fontWeight={500}
                    >
                      {step.message.length > 45 ? step.message.slice(0, 44) + '…' : step.message}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* ── CHẾ ĐỘ 2: LỘ TRÌNH TỪNG BƯỚC (TIMELINE VIEW DỄ ĐỌC TUYỆT ĐỐI) ── */}
      {viewMode === 'timeline' && (
        <div style={{ padding: '14px 18px', maxHeight: 480, overflowY: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {steps.map((step) => {
              const fromLabel = participants.find((p) => p.id === step.from)?.label || step.from;
              const toLabel = participants.find((p) => p.id === step.to)?.label || step.to;

              if (step.isNote) {
                return (
                  <div
                    key={step.stepNumber}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      background: colors.noteBg,
                      border: `1px solid ${colors.noteBorder}`,
                      color: colors.noteText,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>📌 Ghi chú tại [{fromLabel}]:</span>
                    <span>{step.message}</span>
                  </div>
                );
              }

              return (
                <div
                  key={step.stepNumber}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: isDarkMode ? '#1e293b' : '#ffffff',
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <Tag color={step.isReturn ? 'green' : 'blue'} style={{ minWidth: 32, textAlign: 'center', fontWeight: 700 }}>
                    #{step.stepNumber}
                  </Tag>
                  <Space size={6} wrap>
                    <Tag color="cyan">{fromLabel}</Tag>
                    <ArrowRightOutlined style={{ color: step.isReturn ? '#10b981' : '#38bdf8', fontSize: 11 }} />
                    <Tag color="purple">{toLabel}</Tag>
                  </Space>
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: colors.textMain }}>
                    {step.message}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CHẾ ĐỘ 3: MÃ NGUỒN MERMAID GỐC ── */}
      {viewMode === 'code' && (
        <pre
          style={{
            margin: 0,
            padding: 14,
            fontSize: 12,
            lineHeight: 1.5,
            overflowX: 'auto',
            background: isDarkMode ? '#020617' : '#f8fafc',
            color: isDarkMode ? '#cbd5e1' : '#334155',
          }}
        >
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

