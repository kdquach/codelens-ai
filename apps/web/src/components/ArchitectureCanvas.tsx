'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
  NodeProps,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArchitectureGraph, GraphNode, NodeCategory } from '@codelens/shared';
import { Input, Tag, Space, Empty, Tooltip, Button, Segmented, Modal, Typography, message as antMessage } from 'antd';
import {
  SearchOutlined,
  ApiOutlined,
  SettingOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  ToolOutlined,
  CodeOutlined,
  UndoOutlined,
  ApartmentOutlined,
  BranchesOutlined,
  FireOutlined,
  CopyOutlined,
  CheckOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export type DiagramViewMode = 'layered' | 'flow' | 'cluster' | 'data_model' | 'complexity';

interface Props {
  graph: ArchitectureGraph;
  selectedNodeId?: string | null;
  onSelectNode?: (filePath: string) => void;
  isDarkMode?: boolean;
}

// ── Bảng màu sắc & Icon đặc trưng cho từng loại Module ──
export const CATEGORY_CONFIG: Record<
  NodeCategory,
  { label: string; color: string; bgLight: string; bgDark: string; border: string; icon: React.ReactNode }
> = {
  controller: {
    label: 'Controller / API',
    color: '#0284c7',
    bgLight: '#e0f2fe',
    bgDark: 'rgba(56, 189, 248, 0.12)',
    border: '#38bdf8',
    icon: <ApiOutlined />,
  },
  service: {
    label: 'Service / Logic',
    color: '#16a34a',
    bgLight: '#dcfce7',
    bgDark: 'rgba(74, 222, 128, 0.12)',
    border: '#4ade80',
    icon: <SettingOutlined />,
  },
  model: {
    label: 'Model / Database',
    color: '#d97706',
    bgLight: '#fef3c7',
    bgDark: 'rgba(251, 191, 36, 0.12)',
    border: '#fbbf24',
    icon: <DatabaseOutlined />,
  },
  component: {
    label: 'Component / UI',
    color: '#9333ea',
    bgLight: '#f3e8ff',
    bgDark: 'rgba(192, 132, 252, 0.12)',
    border: '#c084fc',
    icon: <AppstoreOutlined />,
  },
  util: {
    label: 'Util / Helper',
    color: '#0891b2',
    bgLight: '#cffafe',
    bgDark: 'rgba(34, 211, 238, 0.12)',
    border: '#22d3ee',
    icon: <ToolOutlined />,
  },
  other: {
    label: 'Khác / Module',
    color: '#64748b',
    bgLight: '#f1f5f9',
    bgDark: 'rgba(148, 163, 184, 0.12)',
    border: '#94a3b8',
    icon: <CodeOutlined />,
  },
};

// ── Custom Node Component hỗ trợ đa góc nhìn ──
interface CustomNodeData {
  graphNode: GraphNode;
  isSelected: boolean;
  isDarkMode: boolean;
  viewMode: DiagramViewMode;
  inDegree: number;
  outDegree: number;
  clusterName?: string;
}

const CustomArchitectureNode = ({ data }: NodeProps) => {
  const nodeData = data as unknown as CustomNodeData;
  const { graphNode, isSelected, isDarkMode, viewMode, inDegree, outDegree, clusterName } = nodeData;
  const config = CATEGORY_CONFIG[graphNode.category] || CATEGORY_CONFIG.other;

  // Đổi màu viền và nền theo chế độ xem
  let borderColor = isSelected ? '#3b82f6' : isDarkMode ? config.border : config.color;
  let customBadge: React.ReactNode = null;

  if (viewMode === 'complexity') {
    const loc = graphNode.loc || 0;
    const isHeavy = loc > 300;
    const isMedium = loc >= 100 && loc <= 300;
    const heatColor = isHeavy ? '#ef4444' : isMedium ? '#f59e0b' : '#10b981';
    borderColor = isSelected ? '#38bdf8' : heatColor;
    customBadge = (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: heatColor,
          background: isDarkMode ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)',
          padding: '1px 5px',
          borderRadius: 4,
        }}
      >
        {isHeavy ? '🔥 Phức tạp cao' : isMedium ? '⚡ Trung bình' : '✨ Gọn gàng'}
      </span>
    );
  } else if (viewMode === 'data_model' && graphNode.category === 'model') {
    borderColor = '#fbbf24';
    customBadge = (
      <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b' }}>
        ENTITY
      </span>
    );
  } else if (viewMode === 'cluster' && clusterName) {
    customBadge = (
      <span style={{ fontSize: 9, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
        <FolderOpenOutlined style={{ marginRight: 3 }} />
        {clusterName}
      </span>
    );
  }

  const bgColor = isDarkMode
    ? isSelected
      ? '#1e293b'
      : '#0f172a'
    : isSelected
    ? '#eff6ff'
    : '#ffffff';

  const textColor = isDarkMode ? '#f8fafc' : '#0f172a';
  const subTextColor = isDarkMode ? '#94a3b8' : '#64748b';

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        padding: '10px 14px',
        color: textColor,
        width: 220,
        boxShadow: isSelected
          ? '0 0 16px rgba(59, 130, 246, 0.6)'
          : isDarkMode
          ? '0 4px 12px rgba(0, 0, 0, 0.4)'
          : '0 2px 8px rgba(0, 0, 0, 0.08)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{ background: config.color, width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{ background: config.color, width: 8, height: 8 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: config.color, width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{ background: config.color, width: 8, height: 8 }}
      />

      {/* Header: Category Badge + Extra Tag */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: config.color,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            textTransform: 'uppercase',
          }}
        >
          {config.icon}
          {graphNode.category}
        </span>
        {customBadge || (
          <span
            style={{
              fontSize: 10,
              color: subTextColor,
              background: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
              padding: '1px 6px',
              borderRadius: 4,
              fontWeight: 500,
            }}
          >
            {graphNode.loc} LOC
          </span>
        )}
      </div>

      {/* Tên file (Label) */}
      <Tooltip title={graphNode.id} placement="top">
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: textColor,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {graphNode.label}
        </div>
      </Tooltip>

      {/* Đường dẫn rút gọn & Thống kê liên kết */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
          fontSize: 10,
          color: subTextColor,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
          {graphNode.id}
        </span>
        <span>
          {inDegree + outDegree > 0 ? `${inDegree} vào • ${outDegree} ra` : ''}
        </span>
      </div>
    </div>
  );
};

const nodeTypes = {
  architectureNode: CustomArchitectureNode,
};

// ── Tự động tạo mã Mermaid từ Đồ thị AST ──
function generateMermaidCode(graph: ArchitectureGraph): string {
  if (!graph.nodes || graph.nodes.length === 0) return 'graph TD\n  Empty[Chưa có dữ liệu đồ thị]';
  const lines: string[] = ['flowchart TD'];

  // Định nghĩa các node
  const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, '_');
  graph.nodes.forEach((n) => {
    lines.push(`  ${safeId(n.id)}["${n.label} (${n.category})"]`);
  });

  // Định nghĩa các liên kết
  (graph.edges || []).forEach((e) => {
    lines.push(`  ${safeId(e.source)} --> ${safeId(e.target)}`);
  });

  return lines.join('\n');
}

export default function ArchitectureCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
  isDarkMode = true,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiagramViewMode>('layered');
  const [isMermaidModalOpen, setIsMermaidModalOpen] = useState(false);
  const [hasCopiedMermaid, setHasCopiedMermaid] = useState(false);

  // Tính bậc liên kết (In-degree & Out-degree)
  const { inDegreeMap, outDegreeMap } = useMemo(() => {
    const inMap: Record<string, number> = {};
    const outMap: Record<string, number> = {};
    (graph.nodes || []).forEach((n) => {
      inMap[n.id] = 0;
      outMap[n.id] = 0;
    });
    (graph.edges || []).forEach((e) => {
      if (outMap[e.source] !== undefined) outMap[e.source]++;
      if (inMap[e.target] !== undefined) inMap[e.target]++;
    });
    return { inDegreeMap: inMap, outDegreeMap: outMap };
  }, [graph]);

  // ── Tính toán vị trí các Node theo từng Loại biểu đồ (Multi-view Layout Engine) ──
  const initialElements = useMemo(() => {
    if (!graph.nodes || graph.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const calculatedNodes: Node[] = [];
    const NODE_WIDTH = 240;
    const NODE_HEIGHT = 90;
    const GAP_X = 60;
    const GAP_Y = 120;

    // Helper kiểm tra hiển thị theo bộ lọc tìm kiếm & category
    const isNodeVisible = (node: GraphNode) => {
      const matchesSearch =
        !searchTerm ||
        node.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !activeCategory || node.category === activeCategory;
      return matchesSearch && matchesCategory;
    };

    // ──────────────────────────────────────────────────────────
    // 1. Chế độ Phân tầng (Layered Stack)
    // ──────────────────────────────────────────────────────────
    if (viewMode === 'layered') {
      const categoryOrder: NodeCategory[] = [
        'controller',
        'service',
        'model',
        'component',
        'util',
        'other',
      ];
      const categoryLayers: Record<NodeCategory, GraphNode[]> = {
        controller: [],
        service: [],
        model: [],
        component: [],
        util: [],
        other: [],
      };
      graph.nodes.forEach((n) => {
        const cat = n.category || 'other';
        (categoryLayers[cat] || categoryLayers.other).push(n);
      });

      let currentY = 50;
      categoryOrder.forEach((cat) => {
        const group = categoryLayers[cat];
        if (group.length === 0) return;
        const perRow = Math.min(Math.max(group.length, 3), 5);
        group.forEach((node, idx) => {
          const col = idx % perRow;
          const row = Math.floor(idx / perRow);
          const x = 50 + col * (NODE_WIDTH + GAP_X);
          const y = currentY + row * (NODE_HEIGHT + GAP_Y);
          const visible = isNodeVisible(node);

          calculatedNodes.push({
            id: node.id,
            type: 'architectureNode',
            position: { x, y },
            data: {
              graphNode: node,
              isSelected: selectedNodeId === node.id,
              isDarkMode,
              viewMode,
              inDegree: inDegreeMap[node.id] || 0,
              outDegree: outDegreeMap[node.id] || 0,
            },
            style: { opacity: visible ? 1 : 0.2, transition: 'opacity 0.2s ease' },
          });
        });
        const rows = Math.ceil(group.length / perRow);
        currentY += rows * (NODE_HEIGHT + GAP_Y) + 30;
      });
    }

    // ──────────────────────────────────────────────────────────
    // 2. Chế độ Luồng có hướng (Directed DAG Flowchart)
    // ──────────────────────────────────────────────────────────
    else if (viewMode === 'flow') {
      // Tính Rank tầng theo Topological DAG
      const ranks: Record<string, number> = {};
      const adj: Record<string, string[]> = {};
      graph.nodes.forEach((n) => {
        adj[n.id] = [];
      });
      (graph.edges || []).forEach((e) => {
        if (adj[e.source]) adj[e.source].push(e.target);
      });

      // Entry points: Controller hoặc inDegree = 0
      const queue: string[] = [];
      graph.nodes.forEach((n) => {
        if ((inDegreeMap[n.id] || 0) === 0 || n.category === 'controller') {
          queue.push(n.id);
          ranks[n.id] = 0;
        }
      });
      if (queue.length === 0 && graph.nodes.length > 0) {
        queue.push(graph.nodes[0].id);
        ranks[graph.nodes[0].id] = 0;
      }

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const currRank = ranks[curr] || 0;
        for (const next of adj[curr] || []) {
          if (ranks[next] === undefined || ranks[next] < currRank + 1) {
            ranks[next] = currRank + 1;
            queue.push(next);
          }
        }
      }

      // Xếp vào từng tầng Rank
      const rankLayers: Record<number, GraphNode[]> = {};
      graph.nodes.forEach((n) => {
        const r = ranks[n.id] || 0;
        if (!rankLayers[r]) rankLayers[r] = [];
        rankLayers[r].push(n);
      });

      const sortedRanks = Object.keys(rankLayers).map(Number).sort((a, b) => a - b);
      sortedRanks.forEach((r) => {
        const group = rankLayers[r];
        const perRow = 4;
        group.forEach((node, idx) => {
          const col = idx % perRow;
          const row = Math.floor(idx / perRow);
          const x = 60 + col * (NODE_WIDTH + GAP_X);
          const y = 50 + r * (NODE_HEIGHT + GAP_Y * 1.2) + row * (NODE_HEIGHT + 30);
          const visible = isNodeVisible(node);

          calculatedNodes.push({
            id: node.id,
            type: 'architectureNode',
            position: { x, y },
            data: {
              graphNode: node,
              isSelected: selectedNodeId === node.id,
              isDarkMode,
              viewMode,
              inDegree: inDegreeMap[node.id] || 0,
              outDegree: outDegreeMap[node.id] || 0,
            },
            style: { opacity: visible ? 1 : 0.2, transition: 'opacity 0.2s ease' },
          });
        });
      });
    }

    // ──────────────────────────────────────────────────────────
    // 3. Chế độ Gom cụm Thư mục / Module (Clustered Module View)
    // ──────────────────────────────────────────────────────────
    else if (viewMode === 'cluster') {
      const getCluster = (path: string) => {
        const parts = path.split('/');
        if (parts.length > 1) {
          // Lấy folder ngay dưới apps/server/src hoặc src/
          const srcIdx = parts.indexOf('src');
          if (srcIdx !== -1 && parts[srcIdx + 1]) {
            return parts[srcIdx + 1];
          }
          return parts[0];
        }
        return 'root';
      };

      const clusters: Record<string, GraphNode[]> = {};
      graph.nodes.forEach((n) => {
        const cl = getCluster(n.id);
        if (!clusters[cl]) clusters[cl] = [];
        clusters[cl].push(n);
      });

      const clusterKeys = Object.keys(clusters);
      const clustersPerRow = 3;

      clusterKeys.forEach((clKey, cIdx) => {
        const cCol = cIdx % clustersPerRow;
        const cRow = Math.floor(cIdx / clustersPerRow);
        const originX = 50 + cCol * (NODE_WIDTH + 80);
        const originY = 50 + cRow * (NODE_HEIGHT * 4 + 120);

        clusters[clKey].forEach((node, nIdx) => {
          const x = originX;
          const y = originY + nIdx * (NODE_HEIGHT + 24);
          const visible = isNodeVisible(node);

          calculatedNodes.push({
            id: node.id,
            type: 'architectureNode',
            position: { x, y },
            data: {
              graphNode: node,
              isSelected: selectedNodeId === node.id,
              isDarkMode,
              viewMode,
              inDegree: inDegreeMap[node.id] || 0,
              outDegree: outDegreeMap[node.id] || 0,
              clusterName: clKey,
            },
            style: { opacity: visible ? 1 : 0.2, transition: 'opacity 0.2s ease' },
          });
        });
      });
    }

    // ──────────────────────────────────────────────────────────
    // 4. Chế độ Mô hình Dữ liệu (ERD / Data Model Focus)
    // ──────────────────────────────────────────────────────────
    else if (viewMode === 'data_model') {
      // Model đặt ở giữa, Service liên quan đặt ở trên, các file khác làm mờ
      const modelNodes = graph.nodes.filter((n) => n.category === 'model');
      const otherNodes = graph.nodes.filter((n) => n.category !== 'model');

      // Tầng 1: Models
      modelNodes.forEach((node, idx) => {
        const x = 80 + idx * (NODE_WIDTH + GAP_X);
        const y = 80;
        calculatedNodes.push({
          id: node.id,
          type: 'architectureNode',
          position: { x, y },
          data: {
            graphNode: node,
            isSelected: selectedNodeId === node.id,
            isDarkMode,
            viewMode,
            inDegree: inDegreeMap[node.id] || 0,
            outDegree: outDegreeMap[node.id] || 0,
          },
        });
      });

      // Tầng 2: Các services và modules còn lại
      const perRow = 4;
      otherNodes.forEach((node, idx) => {
        const col = idx % perRow;
        const row = Math.floor(idx / perRow);
        const x = 80 + col * (NODE_WIDTH + GAP_X);
        const y = 300 + row * (NODE_HEIGHT + GAP_Y);
        const isRelatedToModel = (graph.edges || []).some(
          (e) => (e.source === node.id && modelNodes.some((m) => m.id === e.target)) ||
                 (e.target === node.id && modelNodes.some((m) => m.id === e.source))
        );

        calculatedNodes.push({
          id: node.id,
          type: 'architectureNode',
          position: { x, y },
          data: {
            graphNode: node,
            isSelected: selectedNodeId === node.id,
            isDarkMode,
            viewMode,
            inDegree: inDegreeMap[node.id] || 0,
            outDegree: outDegreeMap[node.id] || 0,
          },
          style: { opacity: isRelatedToModel ? 1 : 0.15, transition: 'opacity 0.2s ease' },
        });
      });
    }

    // ──────────────────────────────────────────────────────────
    // 5. Chế độ Bản đồ Độ phức tạp (LOC Heatmap Matrix)
    // ──────────────────────────────────────────────────────────
    else if (viewMode === 'complexity') {
      // Sắp xếp các node theo LOC giảm dần
      const sortedByLoc = [...graph.nodes].sort((a, b) => (b.loc || 0) - (a.loc || 0));
      const perRow = 4;
      sortedByLoc.forEach((node, idx) => {
        const col = idx % perRow;
        const row = Math.floor(idx / perRow);
        const x = 50 + col * (NODE_WIDTH + GAP_X);
        const y = 50 + row * (NODE_HEIGHT + GAP_Y);
        const visible = isNodeVisible(node);

        calculatedNodes.push({
          id: node.id,
          type: 'architectureNode',
          position: { x, y },
          data: {
            graphNode: node,
            isSelected: selectedNodeId === node.id,
            isDarkMode,
            viewMode,
            inDegree: inDegreeMap[node.id] || 0,
            outDegree: outDegreeMap[node.id] || 0,
          },
          style: { opacity: visible ? 1 : 0.2, transition: 'opacity 0.2s ease' },
        });
      });
    }

    // ── Tạo Edges ──
    const defaultEdgeColor = isDarkMode ? '#475569' : '#94a3b8';
    const highlightEdgeColor = isDarkMode ? '#38bdf8' : '#2563eb';

    const calculatedEdges: Edge[] = (graph.edges || []).map((edge) => {
      const isConnectedToSelected =
        selectedNodeId &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);

      const strokeColor = isConnectedToSelected ? highlightEdgeColor : defaultEdgeColor;

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        animated: !!isConnectedToSelected,
        style: {
          stroke: strokeColor,
          strokeWidth: isConnectedToSelected ? 2.5 : 1.6,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: strokeColor,
        },
      };
    });

    return { nodes: calculatedNodes, edges: calculatedEdges };
  }, [graph, selectedNodeId, searchTerm, activeCategory, isDarkMode, viewMode, inDegreeMap, outDegreeMap]);

  // Quản lý trạng thái Node & Edge để hỗ trợ kéo thả tự do không bị reset
  const [nodes, setNodes, onNodesChange] = useNodesState(initialElements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialElements.edges);

  useEffect(() => {
    setNodes(initialElements.nodes);
    setEdges(initialElements.edges);
  }, [initialElements, setNodes, setEdges]);

  // Đặt lại bố cục ban đầu
  const handleResetLayout = useCallback(() => {
    setNodes(initialElements.nodes);
    setEdges(initialElements.edges);
  }, [initialElements, setNodes, setEdges]);

  // Copy mã Mermaid
  const handleCopyMermaid = () => {
    const mermaidText = generateMermaidCode(graph);
    navigator.clipboard.writeText(mermaidText);
    setHasCopiedMermaid(true);
    antMessage.success('Đã sao chép mã Mermaid vào clipboard!');
    setTimeout(() => setHasCopiedMermaid(false), 2000);
  };

  // Màu sắc khung Canvas theo Theme
  const canvasBg = isDarkMode ? '#090d16' : '#f8fafc';
  const canvasBorder = isDarkMode ? '#1e293b' : '#e2e8f0';
  const panelBg = isDarkMode ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
  const panelBorder = isDarkMode ? '#334155' : '#cbd5e1';
  const gridColor = isDarkMode ? '#1e293b' : '#e2e8f0';

  return (
    <div
      style={{
        width: '100%',
        flex: 1,
        minHeight: 520,
        height: '100%',
        boxSizing: 'border-box',
        background: canvasBg,
        borderRadius: 14,
        overflow: 'hidden',
        border: `1px solid ${canvasBorder}`,
        position: 'relative',
        transition: 'background 0.3s ease, border-color 0.3s ease',
      }}
    >
      {nodes.length === 0 ? (
        <div
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Empty
            description={
              <span style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                Chưa có dữ liệu đồ thị. Vui lòng dán link GitHub và bấm "Phân tích AST".
              </span>
            }
          />
        </div>
      ) : (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => onSelectNode?.(node.id)}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
        >
          {/* Lưới nền tự đổi màu theo theme */}
          <Background color={gridColor} gap={24} size={1.5} />

          {/* Công cụ thu phóng điều hướng */}
          <Controls
            style={{
              background: isDarkMode ? '#0f172a' : '#ffffff',
              borderColor: panelBorder,
              fill: isDarkMode ? '#f8fafc' : '#0f172a',
            }}
          />

          {/* Bản đồ nhỏ MiniMap */}
          <MiniMap
            nodeColor={(node) => {
              const data = node.data as unknown as CustomNodeData;
              const cat = data?.graphNode?.category;
              return CATEGORY_CONFIG[cat]?.color || '#64748b';
            }}
            maskColor={isDarkMode ? 'rgba(9, 13, 22, 0.75)' : 'rgba(241, 245, 249, 0.75)'}
            style={{
              background: isDarkMode ? '#0f172a' : '#ffffff',
              borderRadius: 8,
              border: `1px solid ${panelBorder}`,
            }}
          />

          {/* ── Panel Trên Cùng: Bộ Chọn Loại Biểu Đồ & Tìm Kiếm ── */}
          <Panel position="top-left">
            <div
              style={{
                background: panelBg,
                backdropFilter: 'blur(10px)',
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${panelBorder}`,
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              }}
            >
              {/* Segmented Switcher chọn loại biểu đồ */}
              <Segmented
                size="small"
                value={viewMode}
                onChange={(val) => setViewMode(val as DiagramViewMode)}
                options={[
                  { label: 'Phân tầng', value: 'layered', icon: <ApartmentOutlined /> },
                  { label: 'Luồng phụ thuộc', value: 'flow', icon: <BranchesOutlined /> },
                  { label: 'Cụm Module', value: 'cluster', icon: <AppstoreOutlined /> },
                  { label: 'Lược đồ ERD', value: 'data_model', icon: <DatabaseOutlined /> },
                  { label: 'Độ phức tạp LOC', value: 'complexity', icon: <FireOutlined /> },
                ]}
              />

              <div style={{ width: 1, height: 20, background: panelBorder }} />

              <Input
                size="small"
                prefix={<SearchOutlined style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />}
                placeholder="Tìm file theo tên..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                allowClear
                style={{
                  width: 150,
                  background: isDarkMode ? '#1e293b' : '#ffffff',
                  borderColor: panelBorder,
                  color: isDarkMode ? '#f8fafc' : '#0f172a',
                }}
              />

              <Tooltip title="Sắp xếp lại vị trí các khối theo loại biểu đồ đang chọn">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={handleResetLayout}
                  style={{
                    fontSize: 12,
                    background: isDarkMode ? '#1e293b' : '#ffffff',
                    borderColor: panelBorder,
                    color: isDarkMode ? '#cbd5e1' : '#475569',
                  }}
                >
                  Căn chỉnh
                </Button>
              </Tooltip>

              <Tooltip title="Xem và sao chép mã Mermaid của kiến trúc này">
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  onClick={() => setIsMermaidModalOpen(true)}
                  style={{
                    fontSize: 12,
                    background: isDarkMode ? '#1e293b' : '#ffffff',
                    borderColor: panelBorder,
                    color: isDarkMode ? '#cbd5e1' : '#475569',
                  }}
                >
                  Mermaid
                </Button>
              </Tooltip>
            </div>
          </Panel>

          {/* Panel Trên Phải: Lọc Category */}
          <Panel position="top-right">
            <div
              style={{
                background: panelBg,
                backdropFilter: 'blur(8px)',
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${panelBorder}`,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <Space size={3}>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                  const isActive = activeCategory === key;
                  return (
                    <Tag.CheckableTag
                      key={key}
                      checked={isActive}
                      onChange={() => setActiveCategory(isActive ? null : key)}
                      style={{
                        fontSize: 10,
                        margin: 0,
                        padding: '1px 6px',
                        background: isActive
                          ? isDarkMode
                            ? config.bgDark
                            : config.bgLight
                          : 'transparent',
                        borderColor: config.border,
                        color: isActive ? config.color : isDarkMode ? '#94a3b8' : '#64748b',
                      }}
                    >
                      {config.label.split(' / ')[0]}
                    </Tag.CheckableTag>
                  );
                })}
              </Space>
            </div>
          </Panel>

          {/* Panel Dưới Cùng: Chú giải (Legend) */}
          <Panel position="bottom-left">
            <div
              style={{
                background: panelBg,
                backdropFilter: 'blur(8px)',
                padding: '6px 14px',
                borderRadius: 8,
                border: `1px solid ${panelBorder}`,
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: isDarkMode ? '#94a3b8' : '#475569',
                  fontWeight: 600,
                }}
              >
                Góc nhìn: {
                  viewMode === 'layered' ? '🏢 Phân tầng C4' :
                  viewMode === 'flow' ? '⚡ Luồng phụ thuộc DAG' :
                  viewMode === 'cluster' ? '📦 Cụm Module' :
                  viewMode === 'data_model' ? '🗄️ Mô hình ERD' :
                  '🔥 Bản đồ Nhiệt LOC'
                } ({nodes.length} files • {edges.length} liên kết)
              </span>
            </div>
          </Panel>
        </ReactFlow>
      )}

      {/* Modal hiển thị mã Mermaid Export */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CodeOutlined style={{ color: '#38bdf8' }} />
            <span>Mã Mermaid Kiến Trúc Repository</span>
          </div>
        }
        open={isMermaidModalOpen}
        onCancel={() => setIsMermaidModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setIsMermaidModalOpen(false)}>
            Đóng
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={hasCopiedMermaid ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopyMermaid}
          >
            {hasCopiedMermaid ? 'Đã sao chép' : 'Sao chép mã'}
          </Button>,
        ]}
      >
        <Paragraph style={{ fontSize: 12, color: isDarkMode ? '#94a3b8' : '#64748b' }}>
          Bạn có thể dán đoạn mã này vào Markdown file, README, PR description hoặc công cụ Mermaid Live Editor:
        </Paragraph>
        <pre
          style={{
            background: isDarkMode ? '#0f172a' : '#f1f5f9',
            padding: 14,
            borderRadius: 8,
            maxHeight: 300,
            overflowY: 'auto',
            fontSize: 12,
            fontFamily: 'monospace',
            color: isDarkMode ? '#e2e8f0' : '#1e293b',
            border: `1px solid ${panelBorder}`,
          }}
        >
          {generateMermaidCode(graph)}
        </pre>
      </Modal>
    </div>
  );
}
