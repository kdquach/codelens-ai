'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Button,
  Tag,
  Typography,
  Space,
  Select,
  Switch,
  Divider,
  Collapse,
  Modal,
  Spin,
  Alert,
  Empty,
  Badge,
  Tooltip,
  message,
} from 'antd';
import {
  AuditOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  RocketOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  GithubOutlined,
  ApartmentOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  FilterOutlined,
} from '@ant-design/icons';
import MermaidDiagram from './MermaidDiagram';
import MarkdownRenderer from './MarkdownRenderer';

const { Title, Text, Paragraph } = Typography;

interface PRReviewHubTabProps {
  repoId: string | null;
  repoName?: string;
  repoUrl: string;
  token: string | null;
  isDarkMode: boolean;
  userUsername?: string;
  webhookActive?: boolean;
  onToggleWebhook: (active: boolean) => Promise<void>;
  togglingWebhook?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export default function PRReviewHubTab({
  repoId,
  repoName,
  repoUrl,
  token,
  isDarkMode,
  userUsername,
  webhookActive = false,
  onToggleWebhook,
  togglingWebhook = false,
}: PRReviewHubTabProps) {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [simulatingPR, setSimulatingPR] = useState(false);
  const [riskFilter, setRiskFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');

  // Mermaid Modal
  const [activeMermaidPR, setActiveMermaidPR] = useState<any | null>(null);

  const fetchReviews = useCallback(async () => {
    if (!repoId) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/repos/${repoId}/reviews`, { headers });
      if (res.ok) {
        const data = await res.json();
        setReviews(data);
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách PR Reviews:', err);
    } finally {
      setLoading(false);
    }
  }, [repoId, token]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Simulate PR Review
  const handleSimulatePR = async () => {
    if (!repoId) return;
    setSimulatingPR(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_URL}/webhooks/simulate-pr`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          repoId,
          repoUrl,
          prNumber: Math.floor(Math.random() * 80) + 10,
          title: 'Refactor Core Architecture & Payment Hooks',
          author: userUsername || 'developer-reviewer',
        }),
      });

      if (res.ok) {
        message.success('Đã gửi yêu cầu mô phỏng PR Review vào BullMQ Worker! Đang phân tích qua Gemini...');
        setTimeout(() => {
          fetchReviews();
        }, 3000);
      } else {
        message.error('Không thể kích hoạt mô phỏng PR');
      }
    } catch (err: any) {
      message.error(err.message || 'Lỗi mô phỏng PR');
    } finally {
      setSimulatingPR(false);
    }
  };

  // Metrics computation
  const stats = useMemo(() => {
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let totalRisk = 0;

    reviews.forEach((r) => {
      totalRisk += r.riskScore || 0;
      if (Array.isArray(r.issues)) {
        r.issues.forEach((i: any) => {
          if (i.severity === 'CRITICAL') criticalCount++;
          else if (i.severity === 'HIGH') highCount++;
          else if (i.severity === 'MEDIUM') mediumCount++;
          else lowCount++;
        });
      }
    });

    const avgRisk = reviews.length > 0 ? Math.round(totalRisk / reviews.length) : 0;

    return {
      totalPRs: reviews.length,
      avgRisk,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
    };
  }, [reviews]);

  // Filtered reviews
  const filteredReviews = useMemo(() => {
    if (riskFilter === 'ALL') return reviews;
    return reviews.filter((r) => {
      if (riskFilter === 'HIGH') return r.riskScore >= 70;
      if (riskFilter === 'MEDIUM') return r.riskScore >= 35 && r.riskScore < 70;
      if (riskFilter === 'LOW') return r.riskScore < 35;
      return true;
    });
  }, [reviews, riskFilter]);

  if (!repoId) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Empty description="Vui lòng chọn hoặc nạp một Repository để xem trung tâm Review Pull Request." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflowY: 'auto' }}>
      {/* ── Top Header & Actions ── */}
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
            <AuditOutlined style={{ color: '#0ea5e9' }} />
            Trung tâm Review Pull Request (PR Review Hub)
          </Title>
          <Text type="secondary">
            Tự động phát hiện rủi ro, phân tích module ảnh hưởng và gợi ý sửa lỗi trực tiếp qua GitHub Webhook.
          </Text>
        </div>

        <Space wrap>
          {/* Webhook Toggle */}
          <Card size="small" style={{ padding: '2px 8px', background: isDarkMode ? '#1f1f1f' : '#f5f5f5' }}>
            <Space align="center">
              <Text strong style={{ fontSize: 13 }}>GitHub Webhook Auto-Review:</Text>
              <Switch
                checked={webhookActive}
                loading={togglingWebhook}
                onChange={(checked) => onToggleWebhook(checked)}
                checkedChildren="BẬT"
                unCheckedChildren="TẮT"
              />
            </Space>
          </Card>

          <Button
            type="primary"
            icon={<RocketOutlined />}
            loading={simulatingPR}
            onClick={handleSimulatePR}
            style={{
              background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
              border: 'none',
              fontWeight: 600,
            }}
          >
            ⚡ Mô phỏng Review PR Mới
          </Button>

          <Button icon={<ReloadOutlined />} onClick={fetchReviews} loading={loading}>
            Làm mới
          </Button>
        </Space>
      </div>

      {/* ── Thống kê & Risk Gauge ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              borderRadius: 8,
            }}
          >
            <Statistic
              title="Tổng số PR đã Review"
              value={stats.totalPRs}
              prefix={<AuditOutlined style={{ color: '#1890ff' }} />}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Đã đồng bộ với Webhook GitHub
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              borderRadius: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text type="secondary">Điểm rủi ro trung bình</Text>
                <div style={{ fontSize: 24, fontWeight: 'bold', marginTop: 4 }}>
                  {stats.avgRisk}/100
                </div>
              </div>
              <Progress
                type="circle"
                percent={stats.avgRisk}
                size={54}
                strokeColor={
                  stats.avgRisk >= 70
                    ? '#ff4d4f'
                    : stats.avgRisk >= 35
                    ? '#faad14'
                    : '#52c41a'
                }
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <Tag
                color={
                  stats.avgRisk >= 70
                    ? 'error'
                    : stats.avgRisk >= 35
                    ? 'warning'
                    : 'success'
                }
              >
                {stats.avgRisk >= 70
                  ? 'Mức độ rủi ro CAO'
                  : stats.avgRisk >= 35
                  ? 'Mức độ rủi ro TRUNG BÌNH'
                  : 'Mức độ rủi ro AN TOÀN'}
              </Tag>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              borderRadius: 8,
            }}
          >
            <Statistic
              title="Lỗi Critical & High"
              value={stats.criticalCount + stats.highCount}
              valueStyle={{ color: '#ff4d4f', fontWeight: 'bold' }}
              prefix={<ExclamationCircleOutlined />}
            />
            <Space style={{ marginTop: 8 }}>
              <Tag color="red">Critical: {stats.criticalCount}</Tag>
              <Tag color="volcano">High: {stats.highCount}</Tag>
            </Space>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card
            style={{
              background: isDarkMode ? '#141414' : '#fff',
              border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
              borderRadius: 8,
            }}
          >
            <Statistic
              title="Cảnh báo Medium & Low"
              value={stats.mediumCount + stats.lowCount}
              valueStyle={{ color: '#faad14' }}
              prefix={<SafetyCertificateOutlined />}
            />
            <Space style={{ marginTop: 8 }}>
              <Tag color="orange">Medium: {stats.mediumCount}</Tag>
              <Tag color="green">Low: {stats.lowCount}</Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* ── Toolbar Lọc Rủi ro ── */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Space>
          <FilterOutlined />
          <Text strong>Lọc theo mức độ rủi ro:</Text>
          <Select
            value={riskFilter}
            onChange={(val) => setRiskFilter(val)}
            style={{ width: 180 }}
          >
            <Select.Option value="ALL">Tất cả ({reviews.length})</Select.Option>
            <Select.Option value="HIGH">Rủi ro Cao (≥ 70)</Select.Option>
            <Select.Option value="MEDIUM">Rủi ro Trung bình (35-69)</Select.Option>
            <Select.Option value="LOW">Rủi ro Thấp (&lt; 35)</Select.Option>
          </Select>
        </Space>
      </div>

      {/* ── Danh sách PR Reviews ── */}
      {loading && reviews.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" tip="Đang tải danh sách PR Reviews..." />
        </div>
      ) : filteredReviews.length === 0 ? (
        <Card
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            background: isDarkMode ? '#141414' : '#fff',
            border: `1px solid ${isDarkMode ? '#303030' : '#f0f0f0'}`,
          }}
        >
          <SafetyCertificateOutlined style={{ fontSize: 52, color: '#52c41a', marginBottom: 16 }} />
          <Title level={4}>Chưa có bản ghi Review Pull Request nào phù hợp</Title>
          <Paragraph type="secondary" style={{ maxWidth: 500, margin: '0 auto 20px' }}>
            Hệ thống tự động phân tích khi GitHub gửi Webhook tới endpoint <code>POST /api/webhooks/github</code>.
            Bạn có thể bấm nút <strong>"⚡ Mô phỏng Review PR Mới"</strong> để trải nghiệm phân tích AI ngay lập tức!
          </Paragraph>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            onClick={handleSimulatePR}
            loading={simulatingPR}
          >
            Mô phỏng Review PR Ngay
          </Button>
        </Card>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {filteredReviews.map((rev) => {
            const isHighRisk = rev.riskScore >= 70;
            const isMediumRisk = rev.riskScore >= 35 && rev.riskScore < 70;
            const badgeColor = isHighRisk ? '#ff4d4f' : isMediumRisk ? '#faad14' : '#52c41a';

            return (
              <Card
                key={rev._id || rev.id}
                style={{
                  background: isDarkMode ? '#141414' : '#fff',
                  border: `1px solid ${isDarkMode ? '#303030' : '#e8e8e8'}`,
                  borderRadius: 10,
                }}
              >
                {/* Header card */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <Space wrap>
                      <Tag color="blue" style={{ fontSize: 13, padding: '2px 8px' }}>
                        PR #{rev.prNumber}
                      </Tag>
                      <Text strong style={{ fontSize: 16 }}>
                        {rev.title}
                      </Text>
                    </Space>
                    <div style={{ marginTop: 6 }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        Tác giả: <strong>@{rev.author}</strong> • Trạng thái:{' '}
                        <Tag color={rev.status === 'COMMENTED' ? 'green' : 'blue'}>{rev.status}</Tag> •{' '}
                        {rev.createdAt ? new Date(rev.createdAt).toLocaleString('vi-VN') : ''}
                      </Text>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Badge
                      count={`Risk Score: ${rev.riskScore}/100`}
                      style={{
                        backgroundColor: badgeColor,
                        fontWeight: 700,
                        fontSize: 13,
                        padding: '2px 10px',
                      }}
                    />

                    {rev.mermaidSummary && (
                      <Button
                        size="small"
                        icon={<ApartmentOutlined />}
                        onClick={() => setActiveMermaidPR(rev)}
                      >
                        Sơ đồ Mermaid
                      </Button>
                    )}
                  </div>
                </div>

                <Divider style={{ margin: '14px 0' }} />

                {/* Summary */}
                <Paragraph style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.6 }}>
                  <strong>📝 Tóm tắt AI:</strong> {rev.summary}
                </Paragraph>

                {/* Impacted Files */}
                {rev.impactedFiles && rev.impactedFiles.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <Text strong style={{ fontSize: 13, color: '#faad14' }}>
                      ⚠️ Module phụ thuộc bị ảnh hưởng ({rev.impactedFiles.length}):
                    </Text>
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {rev.impactedFiles.map((file: string) => (
                        <Tag key={file} color="warning" style={{ fontSize: 12 }}>
                          {file}
                        </Tag>
                      ))}
                    </div>
                  </div>
                )}

                {/* Issues List & Suggested Fix */}
                {rev.issues && rev.issues.length > 0 && (
                  <Collapse
                    size="small"
                    ghost
                    items={[
                      {
                        key: 'issues',
                        label: (
                          <Space>
                            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                            <Text strong>
                              Phát hiện {rev.issues.length} vấn đề cần lưu ý và gợi ý sửa lỗi (Suggested Fix)
                            </Text>
                          </Space>
                        ),
                        children: (
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            {rev.issues.map((issue: any, idx: number) => (
                              <div
                                key={idx}
                                style={{
                                  padding: 12,
                                  borderRadius: 6,
                                  background: isDarkMode ? '#1f1f1f' : '#f9f9f9',
                                  border: `1px solid ${isDarkMode ? '#303030' : '#e8e8e8'}`,
                                }}
                              >
                                <Space style={{ marginBottom: 6 }}>
                                  <Tag
                                    color={
                                      issue.severity === 'CRITICAL'
                                        ? 'red'
                                        : issue.severity === 'HIGH'
                                        ? 'volcano'
                                        : issue.severity === 'MEDIUM'
                                        ? 'orange'
                                        : 'green'
                                    }
                                  >
                                    {issue.severity}
                                  </Tag>
                                  <Text strong style={{ fontFamily: 'monospace', fontSize: 13 }}>
                                    {issue.filePath}:{issue.lineNumber}
                                  </Text>
                                </Space>

                                <div style={{ fontSize: 13, color: isDarkMode ? '#d9d9d9' : '#333', marginBottom: 8 }}>
                                  {issue.message}
                                </div>

                                {issue.suggestedFix && (
                                  <div>
                                    <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
                                      💡 Gợi ý sửa lỗi (Suggested Fix):
                                    </Text>
                                    <pre
                                      style={{
                                        margin: '6px 0 0',
                                        padding: 10,
                                        fontSize: 12,
                                        fontFamily: 'SFMono-Regular, Consolas, monospace',
                                        background: isDarkMode ? '#0d1117' : '#f6f8fa',
                                        border: `1px solid ${isDarkMode ? '#30363d' : '#d0d7de'}`,
                                        borderRadius: 6,
                                        overflowX: 'auto',
                                        color: isDarkMode ? '#7ee787' : '#1a7f37',
                                      }}
                                    >
                                      <code>{issue.suggestedFix}</code>
                                    </pre>
                                  </div>
                                )}
                              </div>
                            ))}
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}

                {/* Footer links */}
                {rev.githubCommentUrl && (
                  <div style={{ marginTop: 12, textAlign: 'right' }}>
                    <Button
                      type="link"
                      size="small"
                      icon={<GithubOutlined />}
                      href={rev.githubCommentUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Xem bình luận trực tiếp trên GitHub PR →
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </Space>
      )}

      {/* ── Modal Sơ đồ Thay đổi Mermaid ── */}
      <Modal
        title={
          <Space>
            <ApartmentOutlined style={{ color: '#1890ff' }} />
            <span>Sơ đồ Thay đổi Kiến trúc PR #{activeMermaidPR?.prNumber}: {activeMermaidPR?.title}</span>
          </Space>
        }
        open={!!activeMermaidPR}
        onCancel={() => setActiveMermaidPR(null)}
        footer={[
          <Button key="close" onClick={() => setActiveMermaidPR(null)}>
            Đóng
          </Button>,
        ]}
        width={750}
      >
        {activeMermaidPR?.mermaidSummary ? (
          <div
            style={{
              background: isDarkMode ? '#1e1e1e' : '#f9f9f9',
              padding: 20,
              borderRadius: 8,
              textAlign: 'center',
            }}
          >
            <MermaidDiagram code={activeMermaidPR.mermaidSummary} isDarkMode={isDarkMode} />
          </div>
        ) : (
          <Empty description="Không có sơ đồ Mermaid cho PR này." />
        )}
      </Modal>
    </div>
  );
}

