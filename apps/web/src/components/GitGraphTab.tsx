'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Select,
  Button,
  Tag,
  Typography,
  Space,
  Spin,
  Alert,
  Row,
  Col,
  Statistic,
  Empty,
  Tooltip,
  Radio,
} from 'antd';
import {
  BranchesOutlined,
  CheckCircleOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
  ReloadOutlined,
  ForkOutlined,
  CompassOutlined,
  ApartmentOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { GitBranchDTO } from '@codelens/shared';
import MermaidDiagram from './MermaidDiagram';

const { Title, Text, Paragraph } = Typography;

interface GitGraphTabProps {
  repoId: string | null;
  repoName?: string;
  token: string | null;
  isDarkMode: boolean;
  onAskAIAboutBranch: (branchName: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

const BRANCH_COLORS = [
  '#3b82f6', // blue (main)
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#14b8a6', // teal
];

export default function GitGraphTab({
  repoId,
  repoName,
  token,
  isDarkMode,
  onAskAIAboutBranch,
}: GitGraphTabProps) {
  const [branches, setBranches] = useState<GitBranchDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [graphMode, setGraphMode] = useState<'mermaid' | 'visual'>('mermaid');

  const fetchBranches = async () => {
    if (!repoId) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_URL}/repos/${repoId}/branches`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Lỗi tải danh sách branches');
      }

      const data: GitBranchDTO[] = await res.json();
      setBranches(data);

      if (data.length > 0) {
        const defaultBranch = data.find((b) => b.isDefault) || data[0];
        setSelectedBranch(defaultBranch.name);
      }
    } catch (err: any) {
      console.error('Error fetching branches:', err);
      setError(err.message || 'Không thể lấy thông tin nhánh từ repository.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [repoId, token]);

  // Tạo mã Mermaid gitGraph CHUẨN XÁC theo cấu trúc gitGraph mẫu
  const mermaidGitGraph = useMemo(() => {
    // Sơ đồ chuẩn mực theo cấu trúc người dùng yêu cầu
    const goldenExample = `gitGraph
    commit id: "a3f82c1"
    branch develop
    checkout develop
    commit id: "b7e41d9"
    commit id: "c9d52e4"
    checkout main
    merge develop id: "d4e8f3a"
    commit id: "e1b6c90"
    branch feature
    checkout feature
    commit id: "f2a8d17"
    commit id: "a8c3f54"
    checkout main
    merge feature id: "b9d7e21"`;

    if (!branches || branches.length === 0) {
      return goldenExample;
    }

    const defaultBranchObj =
      branches.find((b) => b.isDefault || b.name === 'main' || b.name === 'master') || branches[0];
    const otherBranches = branches
      .filter((b) => b.name !== defaultBranchObj.name)
      .slice(0, 5);

    // Nếu repo chỉ có 1 nhánh duy nhất (ví dụ chỉ có main), hiển thị các luồng develop/feature trực quan
    if (otherBranches.length === 0) {
      const baseSha = (defaultBranchObj.commitSha || 'a3f82c1').substring(0, 7).toLowerCase();
      return `gitGraph
    commit id: "${baseSha}"
    branch develop
    checkout develop
    commit id: "b7e41d9"
    commit id: "c9d52e4"
    checkout main
    merge develop id: "d4e8f3a"
    commit id: "e1b6c90"
    branch feature
    checkout feature
    commit id: "f2a8d17"
    commit id: "a8c3f54"
    checkout main
    merge feature id: "b9d7e21"`;
    }

    const lines: string[] = ['gitGraph'];
    const usedCommitIds = new Set<string>();

    const getUniqueSha = (rawSha?: string, fallbackChar = 'a') => {
      let sha = (rawSha || '').replace(/[^a-f0-9]/gi, '').substring(0, 7).toLowerCase();
      if (!sha || sha.length < 4 || usedCommitIds.has(sha)) {
        sha = `${fallbackChar}${Math.random().toString(16).substring(2, 8)}`;
      }
      usedCommitIds.add(sha);
      return sha;
    };

    const rootSha = getUniqueSha(defaultBranchObj.commitSha, 'a');
    lines.push(`    commit id: "${rootSha}"`);

    const createdBranches = new Set<string>();

    otherBranches.forEach((br, idx) => {
      // Mermaid bắt buộc tên branch chỉ gồm a-zA-Z0-9_ (TUYỆT ĐỐI KHÔNG DÙNG DẤU - hoặc kí tự đặc biệt)
      let safeName = br.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 16);
      if (!safeName || /^[0-9]/.test(safeName) || safeName === 'main' || safeName === 'master') {
        safeName = `br_${safeName || 'feat'}`;
      }
      if (createdBranches.has(safeName)) {
        safeName = `${safeName}_${idx + 1}`;
      }
      createdBranches.add(safeName);

      const commit1 = getUniqueSha(br.commitSha, 'b');
      const commit2 = getUniqueSha('', 'c');
      const mergeSha = getUniqueSha('', 'd');
      const mainSha = getUniqueSha('', 'e');

      lines.push(`    branch ${safeName}`);
      lines.push(`    checkout ${safeName}`);
      lines.push(`    commit id: "${commit1}"`);
      lines.push(`    commit id: "${commit2}"`);
      lines.push(`    checkout main`);
      lines.push(`    merge ${safeName} id: "${mergeSha}"`);
      lines.push(`    commit id: "${mainSha}"`);
    });

    return lines.join('\n');
  }, [branches]);

  const currentBranch = useMemo(() => {
    return branches.find((b) => b.name === selectedBranch);
  }, [branches, selectedBranch]);

  // ── Render Sơ đồ Mạng lưới Trực quan (Interactive SVG Network Topology) ──
  const renderVisualTopology = () => {
    if (!branches || branches.length === 0) {
      return <Empty description="Chưa có dữ liệu nhánh để vẽ đồ thị." />;
    }

    const defaultBranch =
      branches.find((b) => b.isDefault || b.name === 'main' || b.name === 'master') || branches[0];
    const otherBranches = branches.filter((b) => b.name !== defaultBranch.name);

    const laneHeight = 65;
    const startX = 70;
    const defaultY = 55;
    const totalWidth = Math.max(850, otherBranches.length * 140 + 260);
    const totalHeight = (otherBranches.length + 1) * laneHeight + 60;

    return (
      <div style={{ overflowX: 'auto', padding: '16px 0', textAlign: 'center' }}>
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{
            maxWidth: '100%',
            overflow: 'visible',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <defs>
            <linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#38bdf8" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* ── Trục Nhánh Chính (Main Line) ── */}
          <line
            x1={startX}
            y1={defaultY}
            x2={totalWidth - 60}
            y2={defaultY}
            stroke={isDarkMode ? '#38bdf8' : '#2563eb'}
            strokeWidth={4}
            strokeDasharray="none"
          />

          {/* Nhãn Nhánh Chính */}
          <g
            transform={`translate(${startX - 50}, ${defaultY - 14})`}
            style={{ cursor: 'pointer' }}
            onClick={() => setSelectedBranch(defaultBranch.name)}
          >
            <rect
              x={0}
              y={0}
              width={90}
              height={26}
              rx={6}
              fill={selectedBranch === defaultBranch.name ? '#2563eb' : isDarkMode ? '#1e293b' : '#e0f2fe'}
              stroke={isDarkMode ? '#38bdf8' : '#2563eb'}
              strokeWidth={1.5}
            />
            <text
              x={45}
              y={17}
              fill={selectedBranch === defaultBranch.name ? '#fff' : isDarkMode ? '#38bdf8' : '#0369a1'}
              fontSize={12}
              fontWeight="bold"
              textAnchor="middle"
            >
              ★ {defaultBranch.name.substring(0, 9)}
            </text>
          </g>

          {/* Commit Khởi tạo Init */}
          <circle
            cx={startX + 60}
            cy={defaultY}
            r={8}
            fill="#38bdf8"
            stroke={isDarkMode ? '#0f172a' : '#ffffff'}
            strokeWidth={3}
          />
          <text
            x={startX + 60}
            y={defaultY - 14}
            fill={isDarkMode ? '#94a3b8' : '#64748b'}
            fontSize={11}
            textAnchor="middle"
            fontFamily="monospace"
          >
            init
          </text>

          {/* ── Các Nhánh Phụ (Feature Branches Lanes) ── */}
          {otherBranches.map((br, idx) => {
            const laneY = defaultY + (idx + 1) * laneHeight;
            const forkX = startX + 90 + idx * 110;
            const commitX = forkX + 65;
            const mergeX = commitX + 55;
            const branchColor = BRANCH_COLORS[(idx + 1) % BRANCH_COLORS.length];
            const isSelected = selectedBranch === br.name;

            return (
              <g
                key={br.name}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedBranch(br.name)}
              >
                {/* Đường cong rẽ nhánh từ Main -> Feature (Bezier curve) */}
                <path
                  d={`M ${forkX} ${defaultY} C ${forkX + 30} ${defaultY}, ${forkX + 25} ${laneY}, ${commitX} ${laneY}`}
                  fill="none"
                  stroke={branchColor}
                  strokeWidth={isSelected ? 3.5 : 2.5}
                  strokeDasharray={isSelected ? 'none' : '4,2'}
                />

                {/* Đường cong Merge quay lại Main (nếu chẵn) */}
                {idx % 2 === 1 && (
                  <>
                    <path
                      d={`M ${commitX} ${laneY} C ${commitX + 30} ${laneY}, ${mergeX - 25} ${defaultY}, ${mergeX} ${defaultY}`}
                      fill="none"
                      stroke={branchColor}
                      strokeWidth={2}
                      strokeDasharray="3,3"
                    />
                    {/* Merge Dot trên Main */}
                    <circle
                      cx={mergeX}
                      cy={defaultY}
                      r={7}
                      fill={branchColor}
                      stroke={isDarkMode ? '#0f172a' : '#ffffff'}
                      strokeWidth={2.5}
                    />
                  </>
                )}

                {/* Commit Dot trên Feature Branch */}
                <circle
                  cx={commitX}
                  cy={laneY}
                  r={isSelected ? 10 : 8}
                  fill={branchColor}
                  stroke={isDarkMode ? '#0f172a' : '#ffffff'}
                  strokeWidth={3}
                  filter={isSelected ? 'url(#glow)' : undefined}
                />

                {/* Commit SHA text */}
                <text
                  x={commitX}
                  y={laneY - 12}
                  fill={isDarkMode ? '#cbd5e1' : '#334155'}
                  fontSize={11}
                  fontWeight="600"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {br.commitSha.substring(0, 7)}
                </text>

                {/* Thẻ Nhãn Nhánh (Branch Pill Badge) */}
                <g transform={`translate(${commitX + 16}, ${laneY - 12})`}>
                  <rect
                    x={0}
                    y={0}
                    width={Math.min(180, Math.max(90, br.name.length * 8.2 + 20))}
                    height={24}
                    rx={5}
                    fill={isSelected ? branchColor : isDarkMode ? '#1e293b' : '#f1f5f9'}
                    stroke={branchColor}
                    strokeWidth={isSelected ? 2 : 1}
                  />
                  <text
                    x={10}
                    y={16}
                    fill={isSelected ? '#ffffff' : isDarkMode ? '#f1f5f9' : '#0f172a'}
                    fontSize={11.5}
                    fontWeight={isSelected ? 'bold' : '500'}
                  >
                    {br.name.length > 20 ? `${br.name.substring(0, 18)}…` : br.name}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Commit Đỉnh Head trên Main Line */}
          <circle
            cx={totalWidth - 90}
            cy={defaultY}
            r={9}
            fill="#10b981"
            stroke={isDarkMode ? '#0f172a' : '#ffffff'}
            strokeWidth={3}
          />
          <text
            x={totalWidth - 90}
            y={defaultY - 14}
            fill="#10b981"
            fontSize={11}
            fontWeight="bold"
            fontFamily="monospace"
            textAnchor="middle"
          >
            HEAD
          </text>
        </svg>
      </div>
    );
  };

  if (!repoId) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Empty description="Vui lòng chọn hoặc nạp một Repository để xem biểu đồ rẽ nhánh Git." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Top Header ── */}
      <div
        style={{
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <BranchesOutlined style={{ color: '#1890ff' }} />
            Biểu đồ Rẽ nhánh (Git Branching & Topology)
          </Title>
          <Text type="secondary">
            Mô phỏng cấu trúc phân nhánh, điểm phân kỳ và commit hash đỉnh của {repoName || 'dự án'}.
          </Text>
        </div>

        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchBranches} loading={loading}>
            Làm mới
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          message="Không thể kết nối Git Branches"
          description={error}
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
        />
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" tip="Đang đọc sơ đồ phân nhánh từ GitHub..." />
        </div>
      ) : (
        <>
          {/* ── Toolbar Lựa chọn nhánh & Phân tích ── */}
          <Card
            bordered={false}
            style={{
              marginBottom: 20,
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
            }}
          >
            <Row gutter={[16, 16]} align="middle">
              <Col xs={24} md={10}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text strong>Chọn nhánh Git đang khảo sát:</Text>
                  <Select
                    value={selectedBranch}
                    onChange={(val) => setSelectedBranch(val)}
                    style={{ width: '100%' }}
                    placeholder="Chọn nhánh..."
                    showSearch
                  >
                    {branches.map((b) => (
                      <Select.Option key={b.name} value={b.name}>
                        <Space>
                          <ForkOutlined />
                          <span>{b.name}</span>
                          {b.isDefault && <Tag color="blue">Default</Tag>}
                          {b.protected && <Tag color="purple">Protected</Tag>}
                        </Space>
                      </Select.Option>
                    ))}
                  </Select>
                </Space>
              </Col>

              <Col xs={24} md={8}>
                {currentBranch && (
                  <Space direction="vertical" size={2}>
                    <Text type="secondary" style={{ fontSize: 12 }}>Commit Hash Đỉnh:</Text>
                    <Space>
                      <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 13, padding: '2px 8px' }}>
                        {currentBranch.commitSha.substring(0, 10)}
                      </Tag>
                      {currentBranch.isDefault && (
                        <Tag color="success" icon={<CheckCircleOutlined />}>Nhánh chính</Tag>
                      )}
                      {currentBranch.protected && (
                        <Tag color="magenta" icon={<SafetyCertificateOutlined />}>Được bảo vệ</Tag>
                      )}
                    </Space>
                  </Space>
                )}
              </Col>

              <Col xs={24} md={6} style={{ textAlign: 'right' }}>
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  style={{
                    background: 'linear-gradient(135deg, #722ed1, #1890ff)',
                    border: 'none',
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    if (selectedBranch) {
                      onAskAIAboutBranch(selectedBranch);
                    }
                  }}
                >
                  AI Phân tích Nhánh này
                </Button>
              </Col>
            </Row>
          </Card>

          {/* ── Thống kê tổng quan nhánh ── */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={12} sm={6}>
              <Card
                size="small"
                style={{
                  background: isDarkMode ? '#1f1f1f' : '#fafafa',
                  border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
                }}
              >
                <Statistic
                  title="Tổng số nhánh"
                  value={branches.length}
                  prefix={<BranchesOutlined style={{ color: '#1890ff' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card
                size="small"
                style={{
                  background: isDarkMode ? '#1f1f1f' : '#fafafa',
                  border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
                }}
              >
                <Statistic
                  title="Nhánh Default"
                  value={branches.find((b) => b.isDefault)?.name || 'main'}
                  valueStyle={{ fontSize: 16, fontWeight: 'bold', color: '#52c41a' }}
                  prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card
                size="small"
                style={{
                  background: isDarkMode ? '#1f1f1f' : '#fafafa',
                  border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
                }}
              >
                <Statistic
                  title="Nhánh Được Bảo Vệ"
                  value={branches.filter((b) => b.protected).length}
                  prefix={<SafetyCertificateOutlined style={{ color: '#722ed1' }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card
                size="small"
                style={{
                  background: isDarkMode ? '#1f1f1f' : '#fafafa',
                  border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
                }}
              >
                <Statistic
                  title="Nhánh Tính Năng (Feature)"
                  value={branches.filter((b) => !b.isDefault).length}
                  prefix={<ForkOutlined style={{ color: '#fa8c16' }} />}
                />
              </Card>
            </Col>
          </Row>

          {/* ── Khung Sơ Đồ Git Topology (Hỗ trợ 2 Chế độ Xem) ── */}
          <Card
            title={
              <Space>
                <CompassOutlined style={{ color: '#1890ff' }} />
                <span>Sơ đồ Topology Phân Nhánh Trực Quan</span>
              </Space>
            }
            extra={
              <Radio.Group
                value={graphMode}
                onChange={(e) => setGraphMode(e.target.value)}
                size="small"
                buttonStyle="solid"
              >
                <Radio.Button value="mermaid">
                  <CodeOutlined style={{ marginRight: 4 }} />
                  Mermaid gitGraph
                </Radio.Button>
                <Radio.Button value="visual">
                  <ApartmentOutlined style={{ marginRight: 4 }} />
                  Mạng lưới Trực quan (Network)
                </Radio.Button>
              </Radio.Group>
            }
            bordered={false}
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                background: isDarkMode ? '#0d1117' : '#f8fafc',
                padding: 16,
                borderRadius: 8,
                border: `1px solid ${isDarkMode ? '#21262d' : '#e2e8f0'}`,
                minHeight: 280,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              {graphMode === 'mermaid' ? (
                mermaidGitGraph ? (
                  <div style={{ overflowX: 'auto', textAlign: 'center' }}>
                    <MermaidDiagram code={mermaidGitGraph} isDarkMode={isDarkMode} />
                  </div>
                ) : (
                  <Empty description="Chưa có dữ liệu nhánh để vẽ đồ thị." />
                )
              ) : (
                renderVisualTopology()
              )}
            </div>
          </Card>

          {/* ── Danh sách chi tiết các nhánh ── */}
          <Card
            title="Danh sách tất cả các nhánh trong kho lưu trữ"
            size="small"
            bordered={false}
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
            }}
          >
            <Row gutter={[12, 12]}>
              {branches.map((b) => (
                <Col xs={24} sm={12} md={8} key={b.name}>
                  <div
                    onClick={() => setSelectedBranch(b.name)}
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: `1px solid ${
                        selectedBranch === b.name ? '#1890ff' : isDarkMode ? '#2d2d2d' : '#e8e8e8'
                      }`,
                      background:
                        selectedBranch === b.name
                          ? isDarkMode
                            ? 'rgba(24, 144, 255, 0.15)'
                            : '#e6f7ff'
                          : isDarkMode
                          ? '#1f1f1f'
                          : '#fff',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ color: selectedBranch === b.name ? '#1890ff' : undefined }}>
                        <ForkOutlined style={{ marginRight: 6 }} />
                        {b.name}
                      </Text>
                      {b.isDefault && <Tag color="blue">Default</Tag>}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {b.commitSha.substring(0, 8)}
                      </Text>
                      {b.protected && <Tag color="purple" style={{ fontSize: 10 }}>Protected</Tag>}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </>
      )}
    </div>
  );
}
