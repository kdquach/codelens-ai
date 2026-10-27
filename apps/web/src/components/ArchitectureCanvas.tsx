'use client';

import React, { useMemo, useState } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArchitectureGraph, GraphNode, NodeCategory } from '@codelens/shared';
import { Input, Tag, Space, Empty, Tooltip } from 'antd';
import {
  SearchOutlined,
  ApiOutlined,
  SettingOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  ToolOutlined,
  CodeOutlined,
} from '@ant-design/icons';

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

// ── Custom Node Component hỗ trợ cả Light & Dark Theme ──
interface CustomNodeData {
  graphNode: GraphNode;
  isSelected: boolean;
  isDarkMode: boolean;
}

const CustomArchitectureNode = ({ data }: NodeProps) => {
  const nodeData = data as unknown as CustomNodeData;
  const { graphNode, isSelected, isDarkMode } = nodeData;
  const config = CATEGORY_CONFIG[graphNode.category] || CATEGORY_CONFIG.other;

  const bgColor = isDarkMode
    ? isSelected
      ? '#1e293b'
      : '#0f172a'
    : isSelected
    ? '#eff6ff'
    : '#ffffff';

  const borderColor = isSelected
    ? '#3b82f6'
    : isDarkMode
    ? config.border
    : config.color;

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
      {/* 4 Cổng kết nối (Handles) đa hướng giúp mũi tên kết nối tự nhiên */}
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

      {/* Header: Category Badge + LOC */}
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

      {/* Đường dẫn rút gọn */}
      <div
        style={{
          fontSize: 11,
          color: subTextColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginTop: 2,
        }}
      >
        {graphNode.id}
      </div>
    </div>
  );
};

const nodeTypes = {
  architectureNode: CustomArchitectureNode,
};

export default function ArchitectureCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
  isDarkMode = true,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // ── Tính toán layout phân tầng tự động (Layered Architecture Layout) ──
  const { nodes, edges } = useMemo(() => {
    if (!graph.nodes || graph.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

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

    graph.nodes.forEach((node) => {
      const cat = node.category || 'other';
      if (categoryLayers[cat]) {
        categoryLayers[cat].push(node);
      } else {
        categoryLayers.other.push(node);
      }
    });

    const calculatedNodes: Node[] = [];
    const NODE_WIDTH = 240;
    const NODE_HEIGHT = 100;
    const GAP_X = 60;
    const GAP_Y = 140;

    let currentY = 50;

    categoryOrder.forEach((category) => {
      const groupNodes = categoryLayers[category];
      if (groupNodes.length === 0) return;

      const itemsPerRow = Math.min(Math.max(groupNodes.length, 3), 5);

      groupNodes.forEach((node, index) => {
        const col = index % itemsPerRow;
        const row = Math.floor(index / itemsPerRow);

        const x = 50 + col * (NODE_WIDTH + GAP_X);
        const y = currentY + row * (NODE_HEIGHT + GAP_Y);

        const matchesSearch =
          !searchTerm ||
          node.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          node.id.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesCategory =
          !activeCategory || node.category === activeCategory;

        const isDimmed = !matchesSearch || !matchesCategory;

        calculatedNodes.push({
          id: node.id,
          type: 'architectureNode',
          position: { x, y },
          data: {
            graphNode: node,
            isSelected: selectedNodeId === node.id,
            isDarkMode,
          },
          style: {
            opacity: isDimmed ? 0.2 : 1,
            transition: 'opacity 0.2s ease',
          },
        });
      });

      const totalRows = Math.ceil(groupNodes.length / itemsPerRow);
      currentY += totalRows * (NODE_HEIGHT + GAP_Y) + 40;
    });

    // ── Tạo Edges với MŨI TÊN (ArrowClosed) rõ nét và sinh động ──
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
          strokeWidth: isConnectedToSelected ? 2.5 : 1.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: strokeColor,
        },
      };
    });

    return { nodes: calculatedNodes, edges: calculatedEdges };
  }, [graph, selectedNodeId, searchTerm, activeCategory, isDarkMode]);

  // Màu sắc khung Canvas theo Theme
  const canvasBg = isDarkMode ? '#090d16' : '#f8fafc';
  const canvasBorder = isDarkMode ? '#1e293b' : '#e2e8f0';
  const panelBg = isDarkMode ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)';
  const panelBorder = isDarkMode ? '#334155' : '#cbd5e1';
  const gridColor = isDarkMode ? '#1e293b' : '#e2e8f0';

  return (
    <div
      style={{
        width: '100%',
        height: '75vh',
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

          {/* Panel Trên Cùng: Tìm kiếm & Lọc Category */}
          <Panel position="top-left">
            <div
              style={{
                background: panelBg,
                backdropFilter: 'blur(8px)',
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${panelBorder}`,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              <Input
                size="small"
                prefix={<SearchOutlined style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />}
                placeholder="Tìm file theo tên..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                allowClear
                style={{
                  width: 170,
                  background: isDarkMode ? '#1e293b' : '#ffffff',
                  borderColor: panelBorder,
                  color: isDarkMode ? '#f8fafc' : '#0f172a',
                }}
              />
              <Space size={4}>
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
                  const isActive = activeCategory === key;
                  return (
                    <Tag.CheckableTag
                      key={key}
                      checked={isActive}
                      onChange={() => setActiveCategory(isActive ? null : key)}
                      style={{
                        fontSize: 11,
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

          {/* Panel Dưới Cùng: Chú giải (Legend) & Đếm Edges */}
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
                Mũi tên liên kết ({edges.length}):
              </span>
              {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: config.color,
                      display: 'inline-block',
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#cbd5e1' : '#334155',
                      fontWeight: 500,
                    }}
                  >
                    {config.label.split(' / ')[0]}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </ReactFlow>
      )}
    </div>
  );
}
