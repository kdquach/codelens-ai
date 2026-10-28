'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Timeline,
  List,
  Avatar,
  Tag,
  Typography,
  Space,
  Button,
  Modal,
  Drawer,
  Spin,
  Alert,
  Select,
  Row,
  Col,
  Tooltip,
  Badge,
  Empty,
  Pagination,
  Collapse,
} from 'antd';
import {
  HistoryOutlined,
  UserOutlined,
  BranchesOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  CalendarOutlined,
  CodeOutlined,
  DiffOutlined,
  PlusCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { GitCommitDTO, CommitDiffDTO, GitBranchDTO } from '@codelens/shared';
import MarkdownRenderer from './MarkdownRenderer';

const { Title, Text, Paragraph } = Typography;

interface CommitHistoryTabProps {
  repoId: string | null;
  repoName?: string;
  token: string | null;
  isDarkMode: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function CommitHistoryTab({
  repoId,
  repoName,
  token,
  isDarkMode,
}: CommitHistoryTabProps) {
  const [commits, setCommits] = useState<GitCommitDTO[]>([]);
  const [branches, setBranches] = useState<GitBranchDTO[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const perPage = 15;

  // Commit Detail Modal/Drawer state
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<CommitDiffDTO | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // AI Summarize state
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // Fetch branches
  const fetchBranches = useCallback(async () => {
    if (!repoId) return;
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/repos/${repoId}/branches`, { headers });
      if (res.ok) {
        const data: GitBranchDTO[] = await res.json();
        setBranches(data);
        if (data.length > 0 && !selectedBranch) {
          const def = data.find((b) => b.isDefault) || data[0];
          setSelectedBranch(def.name);
        }
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách nhánh:', err);
    }
  }, [repoId, token, selectedBranch]);

  // Fetch commit list
  const fetchCommits = useCallback(async () => {
    if (!repoId) return;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const queryParams = new URLSearchParams({
        page: String(page),
        perPage: String(perPage),
      });
      if (selectedBranch) {
        queryParams.set('branch', selectedBranch);
      }

      const res = await fetch(`${API_URL}/repos/${repoId}/commits?${queryParams.toString()}`, {
        headers,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Lỗi tải lịch sử commits');
      }

      const data: GitCommitDTO[] = await res.json();
      setCommits(data);
    } catch (err: any) {
      console.error('Error fetching commits:', err);
      setError(err.message || 'Không thể lấy lịch sử commits từ GitHub.');
    } finally {
      setLoading(false);
    }
  }, [repoId, token, selectedBranch, page]);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  useEffect(() => {
    fetchCommits();
  }, [fetchCommits]);

  // Handle click commit -> Open Drawer & fetch detail
  const handleOpenCommit = async (sha: string) => {
    setSelectedSha(sha);
    setIsDetailOpen(true);
    setCommitDetail(null);
    setAiSummary(null);
    setLoadingDetail(true);

    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/repos/${repoId}/commits/${sha}`, { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Lỗi tải chi tiết commit');
      }

      const data: CommitDiffDTO = await res.json();
      setCommitDetail(data);
    } catch (err: any) {
      console.error('Error fetching commit detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Handle AI Summarize
  const handleSummarizeCommit = async () => {
    if (!repoId || !selectedSha) return;
    setSummarizing(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/repos/${repoId}/commits/${selectedSha}/summarize`, {
        method: 'POST',
        headers,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Lỗi khi gọi AI summarize');
      }

      const data = await res.json();
      setAiSummary(data.summary);
    } catch (err: any) {
      console.error('Error summarizing commit:', err);
    } finally {
      setSummarizing(false);
    }
  };

  if (!repoId) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Empty description="Vui lòng chọn hoặc nạp một Repository để xem lịch sử Commit." />
      </div>
    );
  }

  // Render Diff Hunk Lines with GitHub-like syntax colors
  const renderPatchHunk = (patch?: string) => {
    if (!patch) {
      return (
        <div style={{ padding: 12, color: '#8c8c8c', fontStyle: 'italic', fontSize: 13 }}>
          (Không có patch text hoặc file nhị phân)
        </div>
      );
    }

    const lines = patch.split('\n');

    return (
      <pre
        style={{
          margin: 0,
          padding: '8px 0',
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
          fontSize: 12,
          lineHeight: 1.5,
          overflowX: 'auto',
          background: isDarkMode ? '#1e1e1e' : '#f8f9fa',
          borderRadius: 4,
        }}
      >
        {lines.map((line, idx) => {
          let lineBg = 'transparent';
          let lineText = isDarkMode ? '#d4d4d4' : '#24292e';

          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineBg = isDarkMode ? 'rgba(46, 160, 67, 0.2)' : '#e6ffec';
            lineText = isDarkMode ? '#7ee787' : '#1a7f37';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineBg = isDarkMode ? 'rgba(248, 81, 73, 0.2)' : '#ffebe9';
            lineText = isDarkMode ? '#ffa198' : '#cf222e';
          } else if (line.startsWith('@@')) {
            lineBg = isDarkMode ? 'rgba(56, 139, 253, 0.15)' : '#ddf4ff';
            lineText = isDarkMode ? '#79c0ff' : '#0969da';
          }

          return (
            <div
              key={idx}
              style={{
                backgroundColor: lineBg,
                color: lineText,
                padding: '1px 12px',
                whiteSpace: 'pre',
              }}
            >
              {line}
            </div>
          );
        })}
      </pre>
    );
  };

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
            <HistoryOutlined style={{ color: '#52c41a' }} />
            Dòng thời gian Commit & Git Diff Viewer
          </Title>
          <Text type="secondary">
            Theo dõi chi tiết các commit, sự thay đổi mã nguồn và tóm tắt thông minh bằng Gemini 2.5 Flash.
          </Text>
        </div>

        <Space>
          <Select
            value={selectedBranch}
            onChange={(val) => {
              setSelectedBranch(val);
              setPage(1);
            }}
            style={{ width: 180 }}
            placeholder="Lọc theo nhánh..."
            showSearch
          >
            {branches.map((b) => (
              <Select.Option key={b.name} value={b.name}>
                <BranchesOutlined style={{ marginRight: 6 }} />
                {b.name}
              </Select.Option>
            ))}
          </Select>

          <Button icon={<ReloadOutlined />} onClick={fetchCommits} loading={loading}>
            Làm mới
          </Button>
        </Space>
      </div>

      {error && (
        <Alert
          message="Không thể kết nối danh sách Commit"
          description={error}
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
        />
      )}

      {loading && commits.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" tip="Đang tải lịch sử commits từ GitHub..." />
        </div>
      ) : commits.length === 0 ? (
        <Empty description="Không có commit nào được tìm thấy trên nhánh này." />
      ) : (
        <Card
          bordered={false}
          style={{
            background: isDarkMode ? '#141414' : '#fff',
            border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
            borderRadius: 8,
          }}
        >
          <List
            itemLayout="horizontal"
            dataSource={commits}
            renderItem={(item) => (
              <List.Item
                style={{
                  padding: '16px 12px',
                  borderRadius: 6,
                  transition: 'background 0.2s ease',
                  cursor: 'pointer',
                  borderBottom: `1px solid ${isDarkMode ? '#262626' : '#f0f0f0'}`,
                }}
                className="commit-list-item"
                onClick={() => handleOpenCommit(item.sha)}
              >
                <List.Item.Meta
                  avatar={
                    <Avatar
                      src={item.authorAvatarUrl}
                      icon={!item.authorAvatarUrl && <UserOutlined />}
                      size={42}
                      style={{ border: `1px solid ${isDarkMode ? '#434343' : '#d9d9d9'}` }}
                    />
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <Text strong style={{ fontSize: 15 }}>
                        {item.message.split('\n')[0]}
                      </Text>
                      <Space>
                        <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>
                          {item.shortSha}
                        </Tag>
                        {item.stats && (item.stats.additions > 0 || item.stats.deletions > 0) && (
                          <Space size={4}>
                            <Tag color="success" style={{ margin: 0 }}>
                              +{item.stats.additions}
                            </Tag>
                            <Tag color="error" style={{ margin: 0 }}>
                              -{item.stats.deletions}
                            </Tag>
                          </Space>
                        )}
                      </Space>
                    </div>
                  }
                  description={
                    <Space size={16} wrap style={{ marginTop: 4 }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        <UserOutlined style={{ marginRight: 4 }} />
                        {item.authorName}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        <CalendarOutlined style={{ marginRight: 4 }} />
                        {new Date(item.date).toLocaleString('vi-VN')}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Click để xem File Diffs & AI Summarize →
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />

          {/* ── Pagination ── */}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              current={page}
              pageSize={perPage}
              total={100} // GitHub listCommits paging estimate
              onChange={(p) => setPage(p)}
              showSizeChanger={false}
            />
          </div>
        </Card>
      )}

      {/* ── Drawer / Modal Chi tiết Commit & Git Diff Viewer ── */}
      <Drawer
        title={
          <Space>
            <DiffOutlined style={{ color: '#1890ff' }} />
            <span>Chi tiết Commit & Diff Viewer: {selectedSha?.substring(0, 7)}</span>
          </Space>
        }
        placement="right"
        width={850}
        onClose={() => setIsDetailOpen(false)}
        open={isDetailOpen}
        extra={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={summarizing}
            onClick={handleSummarizeCommit}
            style={{
              background: 'linear-gradient(135deg, #1890ff, #722ed1)',
              border: 'none',
              fontWeight: 600,
            }}
          >
            Tóm tắt commit bằng AI
          </Button>
        }
      >
        {loadingDetail ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Spin size="large" tip="Đang tải dữ liệu file diffs..." />
          </div>
        ) : !commitDetail ? (
          <Empty description="Không tìm thấy chi tiết cho commit này." />
        ) : (
          <div>
            {/* ── Header Metadata ── */}
            <Card
              size="small"
              style={{
                marginBottom: 16,
                background: isDarkMode ? '#1f1f1f' : '#fafafa',
                border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              }}
            >
              <Title level={5} style={{ margin: '0 0 8px 0' }}>
                {commitDetail.message}
              </Title>
              <Space wrap size={16}>
                <Space>
                  <Avatar src={commitDetail.authorAvatarUrl} icon={<UserOutlined />} size="small" />
                  <Text strong>{commitDetail.authorName}</Text>
                </Space>
                <Text type="secondary">
                  <CalendarOutlined style={{ marginRight: 4 }} />
                  {new Date(commitDetail.date).toLocaleString('vi-VN')}
                </Text>
                <Tag color="geekblue" style={{ fontFamily: 'monospace' }}>
                  SHA: {commitDetail.sha}
                </Tag>
                <Space size={4}>
                  <Tag color="success">+{commitDetail.stats.additions}</Tag>
                  <Tag color="error">-{commitDetail.stats.deletions}</Tag>
                  <Tag color="default">{commitDetail.files.length} files thay đổi</Tag>
                </Space>
              </Space>
            </Card>

            {/* ── Khung Tóm tắt AI (nếu đã gọi) ── */}
            {aiSummary && (
              <Alert
                message={
                  <Space>
                    <ThunderboltOutlined style={{ color: '#722ed1' }} />
                    <Text strong>Tóm tắt mục đích commit từ Gemini 2.5 Flash:</Text>
                  </Space>
                }
                description={
                  <div style={{ marginTop: 8 }}>
                    <MarkdownRenderer content={aiSummary} isDarkMode={isDarkMode} />
                  </div>
                }
                type="info"
                showIcon={false}
                style={{
                  marginBottom: 16,
                  background: isDarkMode ? 'rgba(114, 46, 209, 0.1)' : '#f9f0ff',
                  borderColor: '#d3adf7',
                }}
              />
            )}

            {/* ── Danh sách File Diffs (GitHub-like) ── */}
            <Title level={5} style={{ margin: '16px 0 12px 0' }}>
              Files Changed ({commitDetail.files.length})
            </Title>

            <Collapse
              defaultActiveKey={commitDetail.files.map((_, i) => String(i))}
              bordered={false}
              style={{ background: 'transparent' }}
              items={commitDetail.files.map((file, idx) => ({
                key: String(idx),
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <FileTextOutlined style={{ color: '#1890ff' }} />
                      <Text strong style={{ fontFamily: 'monospace' }}>
                        {file.filename}
                      </Text>
                      <Tag
                        color={
                          file.status === 'added'
                            ? 'green'
                            : file.status === 'removed'
                            ? 'red'
                            : 'blue'
                        }
                      >
                        {file.status}
                      </Tag>
                    </Space>
                    <Space size={4}>
                      <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
                        +{file.additions}
                      </Tag>
                      <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
                        -{file.deletions}
                      </Tag>
                    </Space>
                  </div>
                ),
                children: renderPatchHunk(file.patch),
                style: {
                  marginBottom: 12,
                  background: isDarkMode ? '#141414' : '#fff',
                  border: `1px solid ${isDarkMode ? '#303030' : '#e8e8e8'}`,
                  borderRadius: 6,
                  overflow: 'hidden',
                },
              }))}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
