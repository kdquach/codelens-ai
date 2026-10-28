'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  Node,
  Edge,
  Panel,
  useNodesState,
  useEdgesState,
  NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Tooltip, Space, Input, Tag } from 'antd';
import {
  UndoOutlined,
  FullscreenOutlined,
  SearchOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  BranchesOutlined,
} from '@ant-design/icons';

export interface ParsedFlowNode {
  id: string;
  label: string;
  shape: 'rect' | 'rounded' | 'rhombus' | 'cylinder' | 'circle' | 'stadium';
  icon?: string;
}

export interface ParsedFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  styleType?: 'solid' | 'dashed' | 'thick';
}

/**
 * Trích xuất nhãn và hình dạng từ cú pháp Mermaid Node
 * Hỗ trợ: [Label], (Label), {Decision}, [(Database)], ((Circle)), ([Stadium])
 */
function extractNodeShapeAndLabel(raw: string): { label: string; shape: ParsedFlowNode['shape']; icon?: string } {
  let cleaned = raw.trim();

  // fa:fa-car Car hoặc fa:fa-database
  let icon: string | undefined;
  const faMatch = cleaned.match(/fa:fa-([a-zA-Z0-9-]+)\s*/i);
  if (faMatch) {
    icon = faMatch[1];
    cleaned = cleaned.replace(faMatch[0], '').trim();
  }

  // [(Database)]
  if (cleaned.startsWith('[(') && cleaned.endsWith(')]')) {
    return { label: cleaned.slice(2, -2).trim(), shape: 'cylinder', icon };
  }
  // ([Stadium])
  if (cleaned.startsWith('([') && cleaned.endsWith('])')) {
    return { label: cleaned.slice(2, -2).trim(), shape: 'stadium', icon };
  }
  // ((Circle))
  if (cleaned.startsWith('((') && cleaned.endsWith('))')) {
    return { label: cleaned.slice(2, -2).trim(), shape: 'circle', icon };
  }
  // {Rhombus / Decision}
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return { label: cleaned.slice(1, -1).trim(), shape: 'rhombus', icon };
  }
  // (Rounded)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return { label: cleaned.slice(1, -1).trim(), shape: 'rounded', icon };
  }
  // [Rectangle]
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    return { label: cleaned.slice(1, -1).trim(), shape: 'rect', icon };
  }

  return { label: cleaned, shape: 'rect', icon };
}

/**
 * Bộ phân tích cú pháp Mermaid Flowchart mềm dẻo (Resilient Flowchart Parser)
 * Hỗ trợ bóc tách cú pháp:
 *   flowchart TD / LR / TB
 *   A[Christmas] -->|Get money| B(Go shopping)
 *   B --> C{Let me think}
 *   C -->|One| D[Laptop]
 */
export function parseMermaidFlowchart(code: string): {
  direction: 'TD' | 'LR';
  nodes: ParsedFlowNode[];
  edges: ParsedFlowEdge[];
} {
  const lines = (code || '').split('\n');
  const nodeMap = new Map<string, ParsedFlowNode>();
  const edgeList: ParsedFlowEdge[] = [];
  let direction: 'TD' | 'LR' = 'TD';

  // Xác định hướng ban đầu
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('graph') || trimmed.startsWith('flowchart')) {
      if (trimmed.includes('LR') || trimmed.includes('RL')) {
        direction = 'LR';
      } else {
        direction = 'TD';
      }
      break;
    }
  }

  // Regex trích xuất Node kèm nhãn định dạng ví dụ: A[Text], B(Text), C{Decision}
  const extractNodeDef = (segment: string) => {
    const match = segment.trim().match(/^([a-zA-Z0-9_.-]+)(\[.*?\]|\(.*?\)|{.*?})?$/);
    if (!match) {
      const fallbackId = segment.trim().replace(/[^a-zA-Z0-9_.-]/g, '');
      return { id: fallbackId || segment.trim(), rawShape: '' };
    }
    return { id: match[1], rawShape: match[2] || '' };
  };

  // Helper đảm bảo node đã được thêm vào map
  const ensureNode = (id: string, rawShape?: string) => {
    if (!id) return;
    if (!nodeMap.has(id)) {
      if (rawShape) {
        const { label, shape, icon } = extractNodeShapeAndLabel(rawShape);
        nodeMap.set(id, { id, label: label || id, shape, icon });
      } else {
        nodeMap.set(id, { id, label: id, shape: 'rect' });
      }
    } else if (rawShape && nodeMap.get(id)?.label === id) {
      // Cập nhật lại nếu trước đó chỉ có ID
      const { label, shape, icon } = extractNodeShapeAndLabel(rawShape);
      nodeMap.set(id, { id, label: label || id, shape, icon });
    }
  };

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('flowchart') || line.startsWith('graph') || line.startsWith('%%')) {
      continue;
    }

    // Pattern nhận diện cạnh nối:
    // A[Node1] -->|Label| B(Node2)
    // A -.->|Label| B
    // A ==>|Label| B
    // A ---|Label| B
    // A --> B
    const linkMatch = line.match(
      /^(.*?)\s*(-->|-.->|==>|---|--\s*\|.*?\|\s*-->?)\s*(?:\|([^|]+)\|\s*)?(.*)$/
    );

    if (linkMatch) {
      const sourcePart = linkMatch[1].trim();
      const arrowSymbol = linkMatch[2].trim();
      let edgeLabel = linkMatch[3]?.trim();
      let targetPart = linkMatch[4].trim();

      // Trường hợp label nằm bên trong ký hiệu ví dụ: -- text -->
      if (!edgeLabel && arrowSymbol.includes('|')) {
        const innerLabelMatch = arrowSymbol.match(/\|(.*?)\|/);
        if (innerLabelMatch) {
          edgeLabel = innerLabelMatch[1].trim();
        }
      }

      // Xử lý node nguồn
      const srcDef = extractNodeDef(sourcePart);
      ensureNode(srcDef.id, srcDef.rawShape);

      // Xử lý node đích
      const tgtDef = extractNodeDef(targetPart);
      ensureNode(tgtDef.id, tgtDef.rawShape);

      let styleType: ParsedFlowEdge['styleType'] = 'solid';
      if (arrowSymbol.includes('-.') || arrowSymbol.includes('.-')) {
        styleType = 'dashed';
      } else if (arrowSymbol.includes('==')) {
        styleType = 'thick';
      }

      edgeList.push({
        id: `e-${srcDef.id}-${tgtDef.id}-${edgeList.length}`,
        source: srcDef.id,
        target: tgtDef.id,
        label: edgeLabel,
        styleType,
      });
      continue;
    }

    // Trường hợp dòng chỉ khai báo một Node đứng riêng
    const singleNodeMatch = line.match(/^([a-zA-Z0-9_.-]+)(\[.*?\]|\(.*?\)|{.*?})$/);
    if (singleNodeMatch) {
      ensureNode(singleNodeMatch[1], singleNodeMatch[2]);
    }
  }

  return {
    direction,
    nodes: Array.from(nodeMap.values()),
    edges: edgeList,
  };
}

// ── Custom Interactive Flow Node Component ──
interface CustomFlowNodeData {
  flowNode: ParsedFlowNode;
  isDarkMode: boolean;
  isSelected: boolean;
  direction: 'TD' | 'LR';
}

const InteractiveNodeComponent = ({ data }: NodeProps) => {
  const nodeData = data as unknown as CustomFlowNodeData;
  const { flowNode, isDarkMode, isSelected, direction } = nodeData;

  const isRhombus = flowNode.shape === 'rhombus';
  const isCylinder = flowNode.shape === 'cylinder';
  const isCircle = flowNode.shape === 'circle';
  const isRounded = flowNode.shape === 'rounded' || flowNode.shape === 'stadium';

  // Phối màu tươi sáng, hiện đại
  const primaryColor = isRhombus ? '#f59e0b' : isCylinder ? '#06b6d4' : '#3b82f6';
  const bgColor = isDarkMode
    ? isSelected
      ? '#1e293b'
      : isRhombus
      ? '#261b07'
      : '#0f172a'
    : isSelected
    ? '#eff6ff'
    : '#ffffff';

  const borderColor = isSelected ? '#38bdf8' : isDarkMode ? '#334155' : '#cbd5e1';
  const textColor = isDarkMode ? '#f8fafc' : '#0f172a';

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: isCircle ? '50%' : isRounded ? '24px' : isRhombus ? '8px' : '10px',
        padding: isRhombus ? '12px 18px' : '10px 16px',
        minWidth: isCircle ? 90 : 130,
        maxWidth: 260,
        minHeight: isCircle ? 90 : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isSelected
          ? '0 0 16px rgba(56, 189, 248, 0.6)'
          : isDarkMode
          ? '0 4px 12px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.06)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'grab',
        position: 'relative',
        textAlign: 'center',
      }}
    >
      {/* Cổng kết nối (Handles) phù hợp hướng TD hoặc LR */}
      <Handle
        type="target"
        position={direction === 'LR' ? Position.Left : Position.Top}
        id="target"
        style={{ background: primaryColor, width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={direction === 'LR' ? Position.Right : Position.Bottom}
        id="source"
        style={{ background: primaryColor, width: 8, height: 8 }}
      />

      {/* Hiển thị ID và Loại Khối */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: primaryColor,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '1px 5px',
            background: isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            borderRadius: 4,
          }}
        >
          {flowNode.id}
        </span>
        {isRhombus && (
          <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>
            {`[Quyết định]`}
          </span>
        )}
      </div>

      {/* Tên nhãn (Label) */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: textColor,
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {flowNode.label}
      </div>
    </div>
  );
};

const nodeTypes = {
  interactiveFlowNode: InteractiveNodeComponent,
};

// ── Thuật toán tính toán vị trí phân tầng tự động (Auto Rank Layout) ──
function computeFlowLayout(
  flowNodes: ParsedFlowNode[],
  flowEdges: ParsedFlowEdge[],
  direction: 'TD' | 'LR',
  isDarkMode: boolean
): { nodes: Node[]; edges: Edge[] } {
  if (flowNodes.length === 0) return { nodes: [], edges: [] };

  // 1. Xây dựng đồ thị phụ thuộc để tính Rank (Tầng)
  const inDegree: Record<string, number> = {};
  const adj: Record<string, string[]> = {};

  flowNodes.forEach((n) => {
    inDegree[n.id] = 0;
    adj[n.id] = [];
  });

  flowEdges.forEach((e) => {
    if (adj[e.source]) adj[e.source].push(e.target);
    if (inDegree[e.target] !== undefined) inDegree[e.target]++;
  });

  // Tính level bằng BFS từ các node in-degree = 0 (root)
  const nodeLevels: Record<string, number> = {};
  const queue: string[] = [];

  flowNodes.forEach((n) => {
    if (inDegree[n.id] === 0) {
      queue.push(n.id);
      nodeLevels[n.id] = 0;
    }
  });

  // Nếu có chu trình hoặc không có root rõ ràng, lấy node đầu tiên làm level 0
  if (queue.length === 0 && flowNodes.length > 0) {
    queue.push(flowNodes[0].id);
    nodeLevels[flowNodes[0].id] = 0;
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLevel = nodeLevels[curr] || 0;
    const neighbors = adj[curr] || [];

    for (const next of neighbors) {
      if (nodeLevels[next] === undefined || nodeLevels[next] < currLevel + 1) {
        nodeLevels[next] = currLevel + 1;
        queue.push(next);
      }
    }
  }

  // Nhóm các node theo tầng
  const layers: Record<number, ParsedFlowNode[]> = {};
  flowNodes.forEach((n) => {
    const lvl = nodeLevels[n.id] || 0;
    if (!layers[lvl]) layers[lvl] = [];
    layers[lvl].push(n);
  });

  const sortedLevels = Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b);

  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 90;
  const GAP_X = 70;
  const GAP_Y = 90;

  const calculatedNodes: Node[] = [];

  sortedLevels.forEach((lvl) => {
    const group = layers[lvl];
    group.forEach((node, idx) => {
      let x = 0;
      let y = 0;

      if (direction === 'TD') {
        const totalWidth = group.length * NODE_WIDTH + (group.length - 1) * GAP_X;
        const startX = Math.max(50, 400 - totalWidth / 2);
        x = startX + idx * (NODE_WIDTH + GAP_X);
        y = 50 + lvl * (NODE_HEIGHT + GAP_Y);
      } else {
        // Hướng Ngang (LR)
        const totalHeight = group.length * NODE_HEIGHT + (group.length - 1) * GAP_Y;
        const startY = Math.max(50, 300 - totalHeight / 2);
        x = 50 + lvl * (NODE_WIDTH + GAP_X);
        y = startY + idx * (NODE_HEIGHT + GAP_Y);
      }

      calculatedNodes.push({
        id: node.id,
        type: 'interactiveFlowNode',
        position: { x, y },
        data: {
          flowNode: node,
          isDarkMode,
          isSelected: false,
          direction,
        },
      });
    });
  });

  // Tạo Edges
  const strokeColor = isDarkMode ? '#94a3b8' : '#64748b';
  const labelBg = isDarkMode ? '#1e293b' : '#ffffff';
  const labelColor = isDarkMode ? '#38bdf8' : '#0284c7';

  const calculatedEdges: Edge[] = flowEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    animated: e.styleType === 'dashed',
    label: e.label,
    labelStyle: {
      fill: labelColor,
      fontWeight: 600,
      fontSize: 11,
    },
    labelBgStyle: {
      fill: labelBg,
      fillOpacity: 0.9,
    },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
    style: {
      stroke: strokeColor,
      strokeWidth: e.styleType === 'thick' ? 3 : 1.8,
      strokeDasharray: e.styleType === 'dashed' ? '5,5' : undefined,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: strokeColor,
    },
  }));

  return { nodes: calculatedNodes, edges: calculatedEdges };
}

interface InteractiveFlowchartViewerProps {
  code: string;
  isDarkMode?: boolean;
  onSwitchToStatic?: () => void;
}

export default function InteractiveFlowchartViewer({
  code,
  isDarkMode = true,
  onSwitchToStatic,
}: InteractiveFlowchartViewerProps) {
  // Parse mã Mermaid
  const parsed = useMemo(() => parseMermaidFlowchart(code), [code]);
  const [currentDirection, setCurrentDirection] = useState<'TD' | 'LR'>(parsed.direction);
  const [searchTerm, setSearchTerm] = useState('');

  // Sinh vị trí mặc định ban đầu
  const initialLayout = useMemo(() => {
    return computeFlowLayout(parsed.nodes, parsed.edges, currentDirection, isDarkMode);
  }, [parsed, currentDirection, isDarkMode]);

  // Quản lý state của các node và edges để người dùng có thể kéo thả tự do
  const [nodes, setNodes, onNodesChange] = useNodesState(initialLayout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialLayout.edges);

  // Cập nhật lại khi layout hoặc theme thay đổi
  useEffect(() => {
    setNodes(initialLayout.nodes);
    setEdges(initialLayout.edges);
  }, [initialLayout, setNodes, setEdges]);

  // Lọc tìm kiếm node
  useEffect(() => {
    if (!searchTerm) {
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          style: { ...n.style, opacity: 1 },
        }))
      );
      return;
    }
    const lower = searchTerm.toLowerCase();
    setNodes((nds) =>
      nds.map((n) => {
        const data = n.data as unknown as CustomFlowNodeData;
        const matches =
          n.id.toLowerCase().includes(lower) ||
          data?.flowNode?.label?.toLowerCase().includes(lower);
        return {
          ...n,
          style: {
            ...n.style,
            opacity: matches ? 1 : 0.25,
            transform: matches ? 'scale(1.04)' : undefined,
            transition: 'all 0.2s ease',
          },
        };
      })
    );
  }, [searchTerm, setNodes]);

  // Đặt lại bố cục (Reset Layout)
  const handleResetLayout = useCallback(() => {
    const reset = computeFlowLayout(parsed.nodes, parsed.edges, currentDirection, isDarkMode);
    setNodes(reset.nodes);
    setEdges(reset.edges);
  }, [parsed, currentDirection, isDarkMode, setNodes, setEdges]);

  // Đổi hướng Flow (TD <-> LR)
  const handleToggleDirection = useCallback(() => {
    const nextDir = currentDirection === 'TD' ? 'LR' : 'TD';
    setCurrentDirection(nextDir);
  }, [currentDirection]);

  const canvasBg = isDarkMode ? '#090d16' : '#f8fafc';
  const canvasBorder = isDarkMode ? '#1e293b' : '#e2e8f0';
  const panelBg = isDarkMode ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.95)';
  const panelBorder = isDarkMode ? '#334155' : '#cbd5e1';

  return (
    <div
      style={{
        width: '100%',
        height: 520,
        position: 'relative',
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${canvasBorder}`,
        background: canvasBg,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color={isDarkMode ? '#1e293b' : '#e2e8f0'} gap={20} size={1.2} />

        <Controls
          style={{
            background: isDarkMode ? '#0f172a' : '#ffffff',
            borderColor: panelBorder,
            fill: isDarkMode ? '#f8fafc' : '#0f172a',
          }}
        />

        <MiniMap
          nodeColor={(n) => {
            const data = n.data as unknown as CustomFlowNodeData;
            return data?.flowNode?.shape === 'rhombus' ? '#f59e0b' : '#3b82f6';
          }}
          maskColor={isDarkMode ? 'rgba(9, 13, 22, 0.75)' : 'rgba(241, 245, 249, 0.75)'}
          style={{
            background: isDarkMode ? '#0f172a' : '#ffffff',
            borderRadius: 8,
            border: `1px solid ${panelBorder}`,
          }}
        />

        {/* Thanh công cụ tùy biến hàng đầu (Top Control Panel) */}
        <Panel position="top-left">
          <div
            style={{
              background: panelBg,
              backdropFilter: 'blur(8px)',
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${panelBorder}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            <Space direction="horizontal" size={6}>
              <Tag color="cyan" style={{ margin: 0, fontWeight: 600 }}>
                <ThunderboltOutlined style={{ marginRight: 4 }} />
                Interactive Flow
              </Tag>

              <Tooltip title="Chuyển hướng sơ đồ: Dọc (TD) hoặc Ngang (LR)">
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={handleToggleDirection}
                  style={{ fontSize: 12 }}
                >
                  {currentDirection === 'TD' ? 'Top-Down' : 'Left-Right'}
                </Button>
              </Tooltip>

              <Tooltip title="Sắp xếp lại vị trí các thành phần tự động">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={handleResetLayout}
                  style={{ fontSize: 12 }}
                >
                  Tự động căn chỉnh
                </Button>
              </Tooltip>

              {onSwitchToStatic && (
                <Tooltip title="Chuyển về xem dạng Mermaid SVG tĩnh">
                  <Button
                    size="small"
                    onClick={onSwitchToStatic}
                    style={{ fontSize: 12 }}
                  >
                    Xem SVG tĩnh
                  </Button>
                </Tooltip>
              )}
            </Space>
          </div>
        </Panel>

        {/* Ô tìm kiếm nhanh Node ở góc trên phải */}
        <Panel position="top-right">
          <div
            style={{
              background: panelBg,
              backdropFilter: 'blur(8px)',
              padding: '6px 10px',
              borderRadius: 8,
              border: `1px solid ${panelBorder}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Input
              size="small"
              placeholder="Tìm kiếm khối trong sơ đồ..."
              prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              allowClear
              style={{ width: 190, fontSize: 12 }}
            />
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
