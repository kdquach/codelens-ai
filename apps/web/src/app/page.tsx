'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ConfigProvider,
  theme,
  Input,
  Button,
  Card,
  Row,
  Col,
  Typography,
  Space,
  Tag,
  Progress,
  Steps,
  message,
  Divider,
  Switch,
  Tooltip,
  Drawer,
  Badge,
  Collapse,
  Avatar,
  Select,
  Popconfirm,
} from 'antd';
import {
  GithubOutlined,
  SendOutlined,
  ApartmentOutlined,
  SyncOutlined,
  RocketOutlined,
  FileTextOutlined,
  BranchesOutlined,
  CodeOutlined,
  SunOutlined,
  MoonOutlined,
  AuditOutlined,
  ExclamationCircleOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  UserOutlined,
  RobotOutlined,
  ClearOutlined,
  BulbOutlined,
  LogoutOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import ArchitectureCanvas from '../components/ArchitectureCanvas';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { ArchitectureGraph, IngestProgressEvent, CodeCitation } from '@codelens/shared';
import { useAuthStore } from '../store/useAuthStore';

const { Title, Text, Paragraph } = Typography;
const { defaultAlgorithm, darkAlgorithm } = theme;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  citations?: CodeCitation[];
  timestamp: string;
  isStreaming?: boolean;
}

export interface RepoItem {
  _id: string;
  owner: string;
  name: string;
  repoUrl: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  isSample?: boolean;
  webhookActive?: boolean;
  webhookId?: string | null;
  summary?: string;
  description?: string;
  architectureGraph?: ArchitectureGraph;
  createdAt: string;
  updatedAt: string;
  userId?: string;
}

export default function HomePage() {
  // ── Auth Store (Sprint 5 - Task TS-24) ──
  const {
    token,
    user,
    isLoading: authLoading,
    initAuth,
    loginWithDemo,
    loginWithGithub,
    logout,
    updateQuota,
    decrementRepoQuota,
    decrementQueryQuota,
  } = useAuthStore();

  // ── Chế độ Sáng / Tối (Light & Dark Mode) ──
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  // Khôi phục theme đã lưu trong localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('codelens_theme');
    if (savedTheme) {
      setIsDarkMode(savedTheme === 'dark');
    }
  }, []);

  const toggleTheme = (checked: boolean) => {
    setIsDarkMode(checked);
    localStorage.setItem('codelens_theme', checked ? 'dark' : 'light');
  };

  // ── Khởi tạo Auth Store khi tải trang ──
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // ── Danh sách Repositories (Task TS-25 Multi-Repository Management) ──
  const [repositories, setRepositories] = useState<RepoItem[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // ── State Repository hiện tại ──
  const [repoUrl, setRepoUrl] = useState('https://github.com/kdquach/CafeVibe');
  const [analyzing, setAnalyzing] = useState(false);
  const [repoId, setRepoId] = useState<string | null>(null);
  const [repoMetadata, setRepoMetadata] = useState<{
    owner?: string;
    name?: string;
    webhookActive?: boolean;
  } | null>(null);
  const [graph, setGraph] = useState<ArchitectureGraph>({ nodes: [], edges: [] });
  const [togglingWebhook, setTogglingWebhook] = useState(false);

  // ── Tiến độ thời gian thực (SSE Progress) ──
  const [progress, setProgress] = useState<number>(0);
  const [step, setStep] = useState<IngestProgressEvent['step'] | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Chat RAG (Hội thoại đa lượt & Task TS-22) ──
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Tự động cuộn xuống đáy khi có tin nhắn mới hoặc streaming
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // ── Sprint 4: PR Reviews Drawer State ──
  const [isPRDrawerOpen, setIsPRDrawerOpen] = useState(false);
  const [prReviews, setPRReviews] = useState<any[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [simulatingPR, setSimulatingPR] = useState(false);

  /**
   * Tải lại danh sách Repositories từ Backend
   */
  const fetchRepositories = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch(`${API_URL}/repos`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setRepositories(data || []);
        return data as RepoItem[];
      }
    } catch (err) {
      console.warn('⚠️ Lỗi tải danh sách repositories:', err);
    } finally {
      setLoadingRepos(false);
    }
    return [];
  }, [token]);

  /**
   * Tải lịch sử trò chuyện của một Repo (Task TS-22 & TS-25)
   */
  const fetchChatHistory = useCallback(
    async (targetRepoId: string) => {
      if (!targetRepoId) return;
      try {
        const res = await fetch(`${API_URL}/repos/${targetRepoId}/chat-history`, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        if (res.ok) {
          const data = await res.json();
          if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
            setMessages(
              data.messages.map((m: any, idx: number) => ({
                id: `history-${idx}-${new Date(m.createdAt).getTime()}`,
                sender: m.role === 'user' ? 'user' : 'ai',
                text: m.content,
                citations: m.citations,
                timestamp: new Date(m.createdAt).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                isStreaming: false,
              }))
            );
          } else {
            setMessages([]);
          }
        }
      } catch (err) {
        console.warn('⚠️ Lỗi tải lịch sử chat:', err);
        setMessages([]);
      }
    },
    [token]
  );

  /**
   * Tải chi tiết Repository (kèm đồ thị ArchitectureGraph)
   */
  const fetchRepoDetails = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/repos/${id}`);
      if (!res.ok) throw new Error('Không thể tải chi tiết Repository');
      const data = await res.json();
      setRepoMetadata({
        owner: data.owner,
        name: data.name,
        webhookActive: data.webhookActive,
      });
      setGraph(data.architectureGraph || { nodes: [], edges: [] });
      message.success(
        `Đã nạp kiến trúc: ${data.architectureGraph?.nodes?.length || 0} files và ${
          data.architectureGraph?.edges?.length || 0
        } mũi tên liên kết.`
      );
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  /**
   * Chọn Repository từ Dropdown / Select
   */
  const handleSelectRepoById = useCallback(
    async (selectedId: string) => {
      const found = repositories.find((r) => r._id === selectedId);
      if (!found) return;

      setRepoId(found._id);
      setRepoUrl(found.repoUrl);
      setSelectedFile(null);
      setRepoMetadata({
        owner: found.owner,
        name: found.name,
        webhookActive: found.webhookActive,
      });

      // Nạp đồ thị kiến trúc nếu đã có
      if (found.architectureGraph && (found.architectureGraph.nodes?.length ?? 0) > 0) {
        setGraph(found.architectureGraph);
      } else if (found.status === 'COMPLETED') {
        fetchRepoDetails(found._id);
      } else {
        setGraph({ nodes: [], edges: [] });
      }

      // Tự động khôi phục lịch sử chat của repo này
      await fetchChatHistory(found._id);
      message.success(`Đã chuyển sang Repository "${found.name}"`);
    },
    [repositories, fetchRepoDetails, fetchChatHistory]
  );

  // Tải danh sách Repos ban đầu & chọn repository đầu tiên
  useEffect(() => {
    const loadInitial = async () => {
      const list = await fetchRepositories();
      if (list && list.length > 0 && !repoId) {
        const first = list[0];
        setRepoId(first._id);
        setRepoUrl(first.repoUrl);
        setRepoMetadata({
          owner: first.owner,
          name: first.name,
          webhookActive: first.webhookActive,
        });
        if ((first.architectureGraph?.nodes?.length ?? 0) > 0) {
          setGraph(first.architectureGraph!);
        } else if (first.status === 'COMPLETED') {
          fetchRepoDetails(first._id);
        }
        fetchChatHistory(first._id);
      }
    };
    loadInitial();
  }, [fetchRepositories, fetchRepoDetails, fetchChatHistory, repoId]);

  // Dọn dẹp SSE connection khi unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const getStepIndex = (currentStep: IngestProgressEvent['step'] | null): number => {
    switch (currentStep) {
      case 'FETCHING':
        return 0;
      case 'PARSING_AST':
        return 1;
      case 'EMBEDDING':
        return 2;
      case 'COMPLETED':
        return 3;
      default:
        return 0;
    }
  };

  /**
   * Xóa Repository (Task TS-21 & TS-25)
   */
  const handleDeleteRepo = async (idToDelete: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const res = await fetch(`${API_URL}/repos/${idToDelete}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Lỗi khi xóa dự án');
      }

      message.success(data.message || 'Đã xóa dự án thành công!');

      // Tải lại danh sách
      const updatedList = await fetchRepositories();

      // Nếu repo bị xóa đang được chọn, chuyển sang repo khác
      if (repoId === idToDelete) {
        if (updatedList && updatedList.length > 0) {
          handleSelectRepoById(updatedList[0]._id);
        } else {
          setRepoId(null);
          setGraph({ nodes: [], edges: [] });
          setMessages([]);
        }
      }
    } catch (err: any) {
      message.error(err.message);
    }
  };

  /**
   * Nạp và Phân tích Repository (Ingest Pipeline)
   */
  const handleAnalyzeRepo = async () => {
    if (!repoUrl) {
      message.warning('Vui lòng nhập đường dẫn GitHub repository!');
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setAnalyzing(true);
    setProgress(5);
    setStep('FETCHING');
    setProgressMsg('Đang gửi yêu cầu nạp repository vào hàng đợi...');

    try {
      const response = await fetch(`${API_URL}/repos/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ repoUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          if (errorData.quota) updateQuota(errorData.quota);
          throw new Error(errorData.message || 'Hạn mức nạp repository hôm nay đã hết!');
        }
        throw new Error(errorData.message || 'Không thể bắt đầu phân tích repository');
      }

      const data = await response.json();
      const currentRepoId = data.repoId;
      setRepoId(currentRepoId);

      // Cập nhật quota ở client
      if (data.quota) {
        updateQuota(data.quota);
      } else {
        decrementRepoQuota();
      }

      // Cập nhật lại danh sách repos
      fetchRepositories();

      // Nếu repo đã COMPLETED sẵn từ trước (Cache hit)
      if (data.status === 'COMPLETED' && (data.architectureGraph?.nodes?.length ?? 0) > 0) {
        setProgress(100);
        setStep('COMPLETED');
        setProgressMsg('Repository đã có sẵn trong cơ sở dữ liệu!');
        setRepoMetadata({
          owner: data.owner,
          name: data.name,
          webhookActive: data.webhookActive,
        });
        setGraph(data.architectureGraph);
        setAnalyzing(false);
        fetchChatHistory(currentRepoId);
        message.success('Đã tải bản đồ kiến trúc có sẵn!');
        return;
      }

      // Lắng nghe tiến độ thời gian thực qua Server-Sent Events (SSE)
      const sse = new EventSource(`${API_URL}/repos/${currentRepoId}/progress`);
      eventSourceRef.current = sse;

      sse.onmessage = (event) => {
        try {
          const progressData: IngestProgressEvent = JSON.parse(event.data);
          setProgress(progressData.progress);
          setStep(progressData.step);
          setProgressMsg(progressData.message);

          if (progressData.step === 'COMPLETED') {
            sse.close();
            fetchRepoDetails(currentRepoId);
            fetchRepositories();
            fetchChatHistory(currentRepoId);
          } else if (progressData.step === 'FAILED') {
            sse.close();
            setAnalyzing(false);
            message.error(progressData.message || 'Tiến trình nạp repository gặp lỗi!');
          }
        } catch {
          // Bỏ qua lỗi parse JSON heartbeat
        }
      };

      sse.onerror = () => {
        sse.close();
      };
    } catch (err: any) {
      setAnalyzing(false);
      message.error(err.message || 'Có lỗi xảy ra khi kết nối máy chủ!');
    }
  };

  /**
   * Bật/Tắt Webhook Auto-Review PR (Task TS-23 & TS-25)
   */
  const handleToggleWebhook = async (checked: boolean) => {
    if (!repoId) return;

    if (!token) {
      message.warning('Vui lòng đăng nhập (hoặc dùng 1-Click Demo) để bật/tắt Webhook Auto-Review PR!');
      return;
    }

    setTogglingWebhook(true);
    try {
      const res = await fetch(`${API_URL}/repos/${repoId}/webhook/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: checked }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Lỗi khi cấu hình webhook');
      }

      setRepoMetadata((prev) => (prev ? { ...prev, webhookActive: data.webhookActive } : null));
      setRepositories((prev) =>
        prev.map((r) => (r._id === repoId ? { ...r, webhookActive: data.webhookActive } : r))
      );
      message.success(data.message || (checked ? 'Đã kích hoạt Webhook' : 'Đã tắt Webhook'));
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setTogglingWebhook(false);
    }
  };

  /**
   * Xóa lịch sử trò chuyện (Task TS-22 & TS-25)
   */
  const handleClearChatHistory = async () => {
    if (repoId) {
      try {
        await fetch(`${API_URL}/repos/${repoId}/chat-history`, {
          method: 'DELETE',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        message.success('Đã xóa toàn bộ lịch sử trò chuyện của dự án.');
      } catch (err: any) {
        console.warn('⚠️ Lỗi xóa lịch sử chat server:', err.message);
      }
    }
    setMessages([]);
  };

  /**
   * Hỏi đáp AI RAG
   */
  const handleAskAI = async (customPrompt?: string) => {
    if (!repoId) {
      message.warning('Vui lòng phân tích Repository trước khi đặt câu hỏi!');
      return;
    }

    const promptText = (customPrompt || question).trim();
    if (!promptText) {
      message.warning('Vui lòng nhập câu hỏi!');
      return;
    }

    // Kiểm tra quota phía client nếu đã đăng nhập
    if (user && user.quota && user.quota.dailyQueriesLeft <= 0) {
      message.error('Hạn mức câu hỏi hôm nay đã hết (Tối đa 20 câu/ngày). Vui lòng quay lại vào ngày mai!');
      return;
    }

    const userMessageId = `user-${Date.now()}`;
    const aiMessageId = `ai-${Date.now() + 1}`;
    const currentTime = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    // 1. Thêm tin nhắn của User
    const userMsg: ChatMessage = {
      id: userMessageId,
      sender: 'user',
      text: promptText,
      timestamp: currentTime,
    };

    // 2. Thêm bong bóng tin nhắn của AI (đang streaming)
    const initialAiMsg: ChatMessage = {
      id: aiMessageId,
      sender: 'ai',
      text: '',
      timestamp: currentTime,
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, initialAiMsg]);
    setQuestion('');
    setChatLoading(true);

    try {
      const historyPayload = messages
        .filter((m) => m.text && !m.isStreaming)
        .slice(-4)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'model',
          text: m.text,
        }));

      const response = await fetch(`${API_URL}/repos/${repoId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: promptText,
          selectedFile,
          history: historyPayload,
        }),
      });

      if (!response.ok) {
        throw new Error('Không thể kết nối đến Trợ lý AI');
      }

      // Trừ 1 query trong quota client
      decrementQueryQuota();

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Trình duyệt không hỗ trợ stream reader');
      }

      let done = false;
      let accumulatedText = '';
      let streamBuffer = '';

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data:')) continue;

            const dataContent = trimmedLine.replace(/^data:\s*/, '').trim();
            if (dataContent === '[DONE]') {
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMessageId ? { ...m, isStreaming: false } : m))
              );
              continue;
            }

            try {
              const parsed = JSON.parse(dataContent);
              if (parsed.token) {
                accumulatedText += parsed.token;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMessageId
                      ? { ...m, text: accumulatedText, isStreaming: true }
                      : m
                  )
                );
              }
              if (parsed.citations && Array.isArray(parsed.citations)) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMessageId ? { ...m, citations: parsed.citations } : m
                  )
                );
              }
              if (parsed.error) {
                accumulatedText += `\n\n⚠️ ${parsed.error}`;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMessageId
                      ? { ...m, text: accumulatedText, isStreaming: false }
                      : m
                  )
                );
              }
            } catch {
              // Bỏ qua chunk chưa đủ JSON
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === aiMessageId ? { ...m, isStreaming: false } : m))
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessageId
            ? {
                ...m,
                text: `⚠️ Lỗi kết nối đến máy chủ AI: ${err.message || 'Không thể nhận phản hồi.'}`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setChatLoading(false);
    }
  };

  /**
   * Mở Drawer xem lịch sử PR Reviews
   */
  const handleOpenPRReviews = async () => {
    setIsPRDrawerOpen(true);
    if (!repoId) return;

    setLoadingReviews(true);
    try {
      const res = await fetch(`${API_URL}/repos/${repoId}/reviews`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setPRReviews(data);
      }
    } catch (err) {
      console.warn('Lỗi tải danh sách reviews:', err);
    } finally {
      setLoadingReviews(false);
    }
  };

  /**
   * Mô phỏng Webhook PR Review
   */
  const handleSimulatePR = async () => {
    setSimulatingPR(true);
    try {
      const res = await fetch(`${API_URL}/webhooks/simulate-pr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          repoId,
          repoUrl,
          prNumber: Math.floor(Math.random() * 80) + 10,
          title: 'Refactor Core Architecture & Payment Hooks',
          author: user ? user.username : 'developer-reviewer',
        }),
      });

      if (res.ok) {
        message.success('Đã gửi yêu cầu mô phỏng PR Review vào BullMQ Worker! Đang phân tích qua Gemini...');
        setTimeout(() => {
          handleOpenPRReviews();
        }, 3000);
      } else {
        message.error('Không thể kích hoạt mô phỏng PR');
      }
    } catch (err: any) {
      message.error(err.message);
    } finally {
      setSimulatingPR(false);
    }
  };

  /**
   * Đăng nhập nhanh 1-Click Demo
   */
  const handleDemoLogin = async () => {
    const res = await loginWithDemo();
    if (res.success) {
      message.success(res.message || 'Chào mừng Nhà tuyển dụng! Đã đăng nhập tài khoản Demo Developer.');
      fetchRepositories();
    } else {
      message.error(res.message || 'Đăng nhập Demo thất bại');
    }
  };

  // Theme colors
  const bgMain = isDarkMode ? '#0a0d14' : '#f8fafc';
  const cardBg = isDarkMode ? '#0f172a' : '#ffffff';
  const cardBorder = isDarkMode ? '#1e293b' : '#e2e8f0';

  const totalLoc = graph.nodes.reduce((acc, curr) => acc + (curr.loc || 0), 0);

  // Phân nhóm Repositories: Của tôi vs Mẫu (Task TS-25)
  const myRepos = repositories.filter((r) => !r.isSample);
  const sampleRepos = repositories.filter((r) => r.isSample);

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? darkAlgorithm : defaultAlgorithm,
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 8,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
      }}
    >
      <div
        style={{
          minHeight: '100vh',
          background: bgMain,
          color: isDarkMode ? '#e2e8f0' : '#1e293b',
          transition: 'background-color 0.3s ease, color 0.3s ease',
        }}
      >
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '16px 24px' }}>
          {/* ── Top Header Bar (Task TS-24 Auth & Quota) ── */}
          <Card
            style={{
              marginBottom: 16,
              background: cardBg,
              borderColor: cardBorder,
              boxShadow: isDarkMode ? '0 4px 20px rgba(0, 0, 0, 0.4)' : '0 2px 10px rgba(0, 0, 0, 0.05)',
            }}
            styles={{ body: { padding: '12px 20px' } }}
          >
            <Row align="middle" justify="space-between" gutter={[16, 12]}>
              {/* Logo & Slogan */}
              <Col xs={24} lg={6}>
                <Space align="center" size={12}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ApartmentOutlined style={{ fontSize: 24, color: '#fff' }} />
                  </div>
                  <div>
                    <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
                      CodeLens AI
                    </Title>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Bản đồ Kiến trúc AST, RAG & Auto PR Reviewer
                    </Text>
                  </div>
                </Space>
              </Col>

              {/* Khu vực Người dùng & Quota (Task TS-24) */}
              <Col xs={24} lg={18} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <Space size={16} wrap align="center">
                  {user ? (
                    // Đã đăng nhập: Hiện Avatar, Username, Role và Hạn mức Quota
                    <Space size={12} align="center" wrap>
                      <Space size={8} align="center">
                        <Avatar
                          src={user.avatarUrl}
                          icon={<UserOutlined />}
                          style={{
                            border: '2px solid #3b82f6',
                            background: '#2563eb',
                          }}
                        />
                        <div>
                          <Text strong style={{ fontSize: 13 }}>
                            {user.username}
                          </Text>
                          <div>
                            <Tag color="blue" style={{ fontSize: 10, padding: '0 6px', margin: 0 }}>
                              {user.role}
                            </Tag>
                          </div>
                        </div>
                      </Space>

                      {/* Huy hiệu Quota thời gian thực (NFR3) */}
                      <Space size={6}>
                        <Tooltip title="Số lượng Repository bạn có thể nạp mới trong ngày (Tối đa 3)">
                          <Tag
                            color={(user.quota?.dailyReposLeft ?? 0) > 0 ? 'cyan' : 'error'}
                            style={{ fontWeight: 600, padding: '2px 8px', borderRadius: 6 }}
                          >
                            📦 Repos: {user.quota?.dailyReposLeft ?? 3}/3
                          </Tag>
                        </Tooltip>
                        <Tooltip title="Số câu hỏi AI RAG bạn có thể gửi trong ngày (Tối đa 20)">
                          <Tag
                            color={(user.quota?.dailyQueriesLeft ?? 0) > 0 ? 'purple' : 'error'}
                            style={{ fontWeight: 600, padding: '2px 8px', borderRadius: 6 }}
                          >
                            💬 Queries: {user.quota?.dailyQueriesLeft ?? 20}/20
                          </Tag>
                        </Tooltip>
                      </Space>

                      <Button
                        size="small"
                        icon={<LogoutOutlined />}
                        onClick={() => {
                          logout();
                          message.info('Đã đăng xuất.');
                          fetchRepositories();
                        }}
                      >
                        Đăng xuất
                      </Button>
                    </Space>
                  ) : (
                    // Chưa đăng nhập: Hiện nút Login GitHub & 1-Click Demo Login
                    <Space size={10} wrap>
                      <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        loading={authLoading}
                        onClick={handleDemoLogin}
                        style={{
                          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                          borderColor: 'transparent',
                          fontWeight: 600,
                        }}
                      >
                        ⚡ 1-Click Demo Login
                      </Button>
                      <Button
                        icon={<GithubOutlined />}
                        onClick={loginWithGithub}
                        style={{ fontWeight: 500 }}
                      >
                        Login with GitHub
                      </Button>
                    </Space>
                  )}

                  <Divider type="vertical" style={{ height: 24 }} />

                  {/* Nút hành động PR Reviews & Dark/Light Mode */}
                  <Space size={10}>
                    <Button
                      icon={<AuditOutlined />}
                      onClick={handleOpenPRReviews}
                      style={{ fontWeight: 600 }}
                    >
                      PR Reviews
                    </Button>

                    <Tooltip title={isDarkMode ? 'Chuyển sang Chế độ Sáng' : 'Chuyển sang Chế độ Tối'}>
                      <Space
                        align="center"
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggleTheme(!isDarkMode)}
                      >
                        {isDarkMode ? (
                          <MoonOutlined style={{ fontSize: 17, color: '#38bdf8' }} />
                        ) : (
                          <SunOutlined style={{ fontSize: 17, color: '#f59e0b' }} />
                        )}
                        <Switch
                          checked={isDarkMode}
                          onChange={toggleTheme}
                          checkedChildren="Tối"
                          unCheckedChildren="Sáng"
                          size="small"
                        />
                      </Space>
                    </Tooltip>
                  </Space>
                </Space>
              </Col>
            </Row>
          </Card>

          {/* ── Thanh Điều hướng Quản lý Repository (Task TS-25) ── */}
          <Card
            style={{
              marginBottom: 16,
              background: cardBg,
              borderColor: cardBorder,
            }}
            styles={{ body: { padding: '14px 20px' } }}
          >
            <Row gutter={[16, 12]} align="middle">
              {/* Dropdown Quản lý Đa Repository */}
              <Col xs={24} md={8} lg={6}>
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
                    CHỌN DỰ ÁN (MULTI-REPO):
                  </Text>
                </div>
                <Select
                  size="large"
                  style={{ width: '100%' }}
                  placeholder="Chọn dự án đã phân tích..."
                  value={repoId || undefined}
                  onChange={handleSelectRepoById}
                  loading={loadingRepos}
                >
                  {myRepos.length > 0 && (
                    <Select.OptGroup label="🚀 Dự án của tôi">
                      {myRepos.map((r) => (
                        <Select.Option key={r._id} value={r._id}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: 160,
                                fontWeight: 500,
                              }}
                            >
                              {r.name}
                            </span>
                            <Space size={4} onClick={(e) => e.stopPropagation()}>
                              <Tag
                                color={r.status === 'COMPLETED' ? 'blue' : 'warning'}
                                style={{ fontSize: 10, margin: 0 }}
                              >
                                {r.status}
                              </Tag>
                              <Popconfirm
                                title="Xác nhận xóa dự án?"
                                description="Toàn bộ Code Chunks, Chat Sessions và PR Reviews sẽ bị xóa."
                                onConfirm={(e) => handleDeleteRepo(r._id, e)}
                                okText="Xóa"
                                cancelText="Hủy"
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
                                />
                              </Popconfirm>
                            </Space>
                          </div>
                        </Select.Option>
                      ))}
                    </Select.OptGroup>
                  )}

                  <Select.OptGroup label="📦 Dự án mẫu (Sample Repos)">
                    {sampleRepos.map((s) => (
                      <Select.Option key={s._id} value={s._id}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{s.name}</span>
                          <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>
                            Mẫu
                          </Tag>
                        </div>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                </Select>
              </Col>

              {/* Ô Nhập URL nạp Repository mới */}
              <Col xs={24} md={16} lg={18}>
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
                    HOẶC NẠP REPOSITORY MỚI TỪ GITHUB:
                  </Text>
                </div>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    size="large"
                    prefix={<GithubOutlined style={{ color: '#94a3b8' }} />}
                    placeholder="Dán URL GitHub (Ví dụ: https://github.com/owner/repo)..."
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onPressEnter={handleAnalyzeRepo}
                    disabled={analyzing}
                  />
                  <Button
                    type="primary"
                    size="large"
                    icon={analyzing ? <SyncOutlined spin /> : <RocketOutlined />}
                    loading={analyzing}
                    onClick={handleAnalyzeRepo}
                    style={{
                      background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                      borderColor: 'transparent',
                      fontWeight: 600,
                      padding: '0 24px',
                    }}
                  >
                    {analyzing ? 'Đang phân tích...' : 'Phân tích AST'}
                  </Button>
                </Space.Compact>
              </Col>
            </Row>
          </Card>

          {/* ── Thanh tiến trình nạp Repository thời gian thực ── */}
          {analyzing && (
            <Card
              style={{
                marginBottom: 16,
                background: cardBg,
                borderColor: cardBorder,
              }}
              styles={{ body: { padding: '14px 20px' } }}
            >
              <Row align="middle" gutter={[16, 16]}>
                <Col xs={24} lg={16}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Space>
                      <SyncOutlined spin style={{ color: '#38bdf8' }} />
                      <Text strong style={{ fontSize: 14 }}>
                        {progressMsg || 'Đang quét repository...'}
                      </Text>
                    </Space>
                    <Tag color={step === 'COMPLETED' ? 'success' : 'processing'} style={{ fontWeight: 600 }}>
                      {progress}%
                    </Tag>
                  </div>

                  <Progress
                    percent={progress}
                    status={step === 'FAILED' ? 'exception' : 'active'}
                    strokeColor={{
                      '0%': '#3b82f6',
                      '50%': '#8b5cf6',
                      '100%': '#10b981',
                    }}
                    showInfo={false}
                  />
                </Col>

                <Col xs={24} lg={8}>
                  <Steps
                    size="small"
                    current={getStepIndex(step)}
                    items={[
                      { title: 'Tải Git', description: 'GitHub Blobs' },
                      { title: 'AST Parser', description: 'ts-morph RAM' },
                      { title: 'Vector AI', description: 'Gemini 768d' },
                      { title: 'Sẵn sàng', description: 'Render Canvas' },
                    ]}
                  />
                </Col>
              </Row>
            </Card>
          )}

          {/* ── Thông tin & Bật/Tắt Webhook Auto-Review PR (Task TS-23 & TS-25) ── */}
          {repoMetadata && !analyzing && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 18px',
                background: cardBg,
                borderRadius: 10,
                border: `1px solid ${cardBorder}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <Space size={16} wrap align="center">
                <span style={{ fontWeight: 700, fontSize: 14 }}>
                  📦 {repoMetadata.owner}/{repoMetadata.name}
                </span>
                <Divider type="vertical" />
                <Space size={4}>
                  <FileTextOutlined style={{ color: '#38bdf8' }} />
                  <Text style={{ fontSize: 13 }}>
                    Files: <strong style={{ color: '#38bdf8' }}>{graph.nodes.length}</strong>
                  </Text>
                </Space>
                <Space size={4}>
                  <BranchesOutlined style={{ color: '#10b981' }} />
                  <Text style={{ fontSize: 13 }}>
                    Liên kết: <strong style={{ color: '#10b981' }}>{graph.edges.length}</strong>
                  </Text>
                </Space>
                <Space size={4}>
                  <CodeOutlined style={{ color: '#f59e0b' }} />
                  <Text style={{ fontSize: 13 }}>
                    Tổng LOC: <strong style={{ color: '#f59e0b' }}>{totalLoc.toLocaleString()}</strong>
                  </Text>
                </Space>
              </Space>

              {/* Nút Gạt Webhook Auto-Review PR (Task TS-23) & Phím tắt */}
              <Space size={16} align="center" wrap>
                <Space size={8} align="center">
                  <Text style={{ fontSize: 13, fontWeight: 500 }}>Auto-Review PR:</Text>
                  <Tooltip title="Tự động bóc tách git diff và đăng nhận xét lên GitHub khi có PR mới">
                    <Switch
                      checked={repoMetadata.webhookActive || false}
                      loading={togglingWebhook}
                      onChange={handleToggleWebhook}
                      checkedChildren="BẬT"
                      unCheckedChildren="TẮT"
                    />
                  </Tooltip>
                  {repoMetadata.webhookActive && (
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      Active
                    </Tag>
                  )}
                </Space>

                <Button size="small" type="primary" ghost icon={<AuditOutlined />} onClick={handleOpenPRReviews}>
                  Xem AI PR Reviews
                </Button>
              </Space>
            </div>
          )}

          {/* ── Không gian làm việc: Đồ thị React Flow & Trợ lý RAG ── */}
          <Row gutter={[16, 16]}>
            {/* Cột Trái: Bản đồ Kiến trúc Canvas */}
            <Col xs={24} lg={16}>
              <ArchitectureCanvas
                graph={graph}
                selectedNodeId={selectedFile}
                onSelectNode={(file) => setSelectedFile(file)}
                isDarkMode={isDarkMode}
              />
            </Col>

            {/* Cột Phải: Trợ lý Code-Aware AI RAG & Chat Sessions (Task TS-22) */}
            <Col xs={24} lg={8}>
              <Card
                title={
                  <Space>
                    <RobotOutlined style={{ color: '#38bdf8', fontSize: 18 }} />
                    <span style={{ fontWeight: 600 }}>AI Code Architect</span>
                    <Tag color="purple">Gemini 2.5 Flash</Tag>
                  </Space>
                }
                extra={
                  messages.length > 0 ? (
                    <Popconfirm
                      title="Xóa lịch sử đoạn chat?"
                      description="Toàn bộ tin nhắn trước đó của dự án này sẽ được xóa trắng."
                      onConfirm={handleClearChatHistory}
                      okText="Xóa"
                      cancelText="Hủy"
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<ClearOutlined />}
                        style={{ color: '#94a3b8' }}
                      >
                        Xóa chat
                      </Button>
                    </Popconfirm>
                  ) : null
                }
                style={{
                  height: '75vh',
                  background: cardBg,
                  borderColor: cardBorder,
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: isDarkMode
                    ? '0 4px 20px rgba(0, 0, 0, 0.4)'
                    : '0 2px 12px rgba(0, 0, 0, 0.05)',
                }}
                styles={{
                  body: {
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    padding: '12px 16px',
                  },
                }}
              >
                {selectedFile && (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: '6px 10px',
                      background: isDarkMode ? 'rgba(56, 189, 248, 0.12)' : '#e0f2fe',
                      borderRadius: 6,
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: isDarkMode ? '#38bdf8' : '#0284c7', fontSize: 12 }}>
                      🎯 Ngữ cảnh ưu tiên: <strong>{selectedFile}</strong>
                    </Text>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => setSelectedFile(null)}
                      style={{ padding: 0 }}
                    >
                      Bỏ chọn
                    </Button>
                  </div>
                )}

                {/* ── Khung Hội Thoại Tin Nhắn (Cuộc trò chuyện Chatbox) ── */}
                <div
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    marginBottom: 12,
                    padding: '12px 10px',
                    background: isDarkMode ? '#020617' : '#f8fafc',
                    borderRadius: 8,
                    border: `1px solid ${cardBorder}`,
                  }}
                >
                  {messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px 12px', color: '#94a3b8' }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(124, 58, 237, 0.2))',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          margin: '0 auto 12px',
                          color: '#38bdf8',
                          fontSize: 24,
                        }}
                      >
                        <RobotOutlined />
                      </div>
                      <Text strong style={{ fontSize: 14, color: isDarkMode ? '#e2e8f0' : '#1e293b' }}>
                        Trợ lý AI CodeLens Sẵn sàng
                      </Text>
                      <div style={{ fontSize: 12, marginTop: 4, marginBottom: 18, color: '#94a3b8' }}>
                        Hỏi bất kỳ điều gì về luồng nghiệp vụ, hàm hoặc kiến trúc của Repository này.
                      </div>

                      {/* Gợi ý câu hỏi nhanh */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380, margin: '0 auto' }}>
                        {[
                          'Chức năng favorite hoạt động như thế nào?',
                          'Luồng xác thực và phân quyền người dùng?',
                          'Vẽ sơ đồ tương tác giữa các controllers và services?',
                        ].map((promptText, idx) => (
                          <Button
                            key={idx}
                            size="small"
                            style={{
                              textAlign: 'left',
                              fontSize: 12,
                              height: 'auto',
                              padding: '8px 12px',
                              whiteSpace: 'normal',
                              background: isDarkMode ? '#1e293b' : '#ffffff',
                              borderColor: cardBorder,
                              borderRadius: 6,
                            }}
                            onClick={() => handleAskAI(promptText)}
                          >
                            <Space align="start">
                              <BulbOutlined style={{ color: '#f59e0b', marginTop: 2 }} />
                              <span>{promptText}</span>
                            </Space>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row',
                              gap: 8,
                              maxWidth: '92%',
                            }}
                          >
                            {/* Avatar */}
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                background:
                                  msg.sender === 'user'
                                    ? 'linear-gradient(135deg, #2563eb, #7c3aed)'
                                    : isDarkMode
                                    ? '#1e293b'
                                    : '#e2e8f0',
                                color: msg.sender === 'user' ? '#ffffff' : '#38bdf8',
                                fontSize: 14,
                              }}
                            >
                              {msg.sender === 'user' ? <UserOutlined /> : <RobotOutlined />}
                            </div>

                            {/* Bong bóng tin nhắn */}
                            <div
                              style={{
                                padding: '10px 14px',
                                borderRadius:
                                  msg.sender === 'user'
                                    ? '16px 16px 4px 16px'
                                    : '16px 16px 16px 4px',
                                background:
                                  msg.sender === 'user'
                                    ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
                                    : isDarkMode
                                    ? '#0f172a'
                                    : '#ffffff',
                                color: msg.sender === 'user' ? '#ffffff' : isDarkMode ? '#e2e8f0' : '#1e293b',
                                border:
                                  msg.sender === 'user'
                                    ? 'none'
                                    : isDarkMode
                                    ? '1px solid #1e293b'
                                    : '1px solid #e2e8f0',
                                boxShadow: isDarkMode
                                  ? '0 2px 8px rgba(0, 0, 0, 0.25)'
                                  : '0 1px 4px rgba(0, 0, 0, 0.05)',
                              }}
                            >
                              {msg.sender === 'user' ? (
                                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>
                                  {msg.text}
                                </div>
                              ) : (
                                <div>
                                  <MarkdownRenderer
                                    content={msg.text}
                                    isStreaming={msg.isStreaming}
                                    onCitationClick={(filePath) => setSelectedFile(filePath)}
                                  />

                                  {/* Hiển thị Citations */}
                                  {msg.citations && msg.citations.length > 0 && (
                                    <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #334155' }}>
                                      <Text type="secondary" style={{ fontSize: 11 }}>
                                        Trích dẫn nguồn AST:
                                      </Text>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                                        {msg.citations.map((c, i) => (
                                          <Tag
                                            key={i}
                                            color="cyan"
                                            style={{ cursor: 'pointer', fontSize: 11 }}
                                            onClick={() => setSelectedFile(c.filePath)}
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
                          <span
                            style={{
                              fontSize: 10,
                              color: '#64748b',
                              marginTop: 4,
                              marginRight: msg.sender === 'user' ? 36 : 0,
                              marginLeft: msg.sender === 'ai' ? 36 : 0,
                            }}
                          >
                            {msg.timestamp}
                          </span>
                        </div>
                      ))}
                      <div ref={chatBottomRef} />
                    </div>
                  )}
                </div>

                {/* ── Ô nhập tin nhắn ── */}
                <Space.Compact style={{ width: '100%' }}>
                  <Input.TextArea
                    rows={2}
                    placeholder="Hỏi AI về mã nguồn, luồng dữ liệu..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAskAI();
                      }
                    }}
                    disabled={chatLoading}
                    style={{ resize: 'none' }}
                  />
                  <Button
                    type="primary"
                    icon={chatLoading ? <SyncOutlined spin /> : <SendOutlined />}
                    loading={chatLoading}
                    onClick={() => handleAskAI()}
                    style={{
                      height: 'auto',
                      padding: '0 20px',
                      background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                    }}
                  >
                    Gửi
                  </Button>
                </Space.Compact>
              </Card>
            </Col>
          </Row>
        </div>

        {/* ── Drawer Lịch sử PR Reviews (Sprint 4) ── */}
        <Drawer
          title={
            <Space>
              <AuditOutlined style={{ color: '#38bdf8' }} />
              <span>Bảng Thống kê & Lịch sử AI Review Pull Request</span>
            </Space>
          }
          placement="right"
          width={640}
          onClose={() => setIsPRDrawerOpen(false)}
          open={isPRDrawerOpen}
          extra={
            <Button
              type="primary"
              size="small"
              icon={<RocketOutlined />}
              onClick={handleSimulatePR}
              loading={simulatingPR}
            >
              Mô phỏng Review PR Mới
            </Button>
          }
        >
          {loadingReviews ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <SyncOutlined spin style={{ fontSize: 28, color: '#3b82f6' }} />
              <Paragraph style={{ marginTop: 12 }}>Đang tải danh sách Review PR...</Paragraph>
            </div>
          ) : prReviews.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <SafetyCertificateOutlined style={{ fontSize: 48, opacity: 0.6, marginBottom: 16 }} />
              <Title level={5}>Chưa có bản ghi Review Pull Request nào</Title>
              <Paragraph style={{ color: '#94a3b8' }}>
                Hệ thống sẽ tự động phân tích khi GitHub gửi Webhook tới endpoint <code>POST /api/webhooks/github</code>.
                Bạn cũng có thể bấm nút <strong>"Mô phỏng Review PR Mới"</strong> góc trên để trải nghiệm ngay!
              </Paragraph>
              <Button type="primary" icon={<RocketOutlined />} onClick={handleSimulatePR} loading={simulatingPR}>
                Chạy Thử Nghiệm Ngay
              </Button>
            </div>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {prReviews.map((rev) => {
                const isHighRisk = rev.riskScore >= 70;
                const isMediumRisk = rev.riskScore >= 35 && rev.riskScore < 70;
                const badgeColor = isHighRisk ? '#ef4444' : isMediumRisk ? '#f59e0b' : '#10b981';

                return (
                  <Card
                    key={rev._id}
                    size="small"
                    style={{
                      background: isDarkMode ? '#1e293b' : '#f8fafc',
                      borderColor: cardBorder,
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <Space>
                          <Tag color="blue">PR #{rev.prNumber}</Tag>
                          <Text strong style={{ fontSize: 15 }}>{rev.title}</Text>
                        </Space>
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Tác giả: <strong>@{rev.author}</strong> • Trạng thái: <Tag color="green">{rev.status}</Tag>
                          </Text>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <Badge
                          count={`Risk: ${rev.riskScore}/100`}
                          style={{
                            backgroundColor: badgeColor,
                            fontWeight: 700,
                            padding: '0 10px',
                            fontSize: 13,
                          }}
                        />
                      </div>
                    </div>

                    <Divider style={{ margin: '12px 0' }} />

                    {/* Summary */}
                    <Paragraph style={{ fontSize: 13, marginBottom: 10 }}>
                      <strong>📝 Tóm tắt:</strong> {rev.summary}
                    </Paragraph>

                    {/* Cross-file Impact */}
                    {rev.impactedFiles && rev.impactedFiles.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <Text strong style={{ fontSize: 12, color: '#f59e0b' }}>
                          ⚠️ Module phụ thuộc bị ảnh hưởng ({rev.impactedFiles.length}):
                        </Text>
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {rev.impactedFiles.map((f: string) => (
                            <Tag key={f} color="warning" style={{ fontSize: 11 }}>{f}</Tag>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Issues detected */}
                    {rev.issues && rev.issues.length > 0 && (
                      <Collapse
                        size="small"
                        ghost
                        items={[
                          {
                            key: 'issues',
                            label: (
                              <Space>
                                <ExclamationCircleOutlined style={{ color: '#ef4444' }} />
                                <Text strong>Phát hiện {rev.issues.length} vấn đề cần lưu ý</Text>
                              </Space>
                            ),
                            children: (
                              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                {rev.issues.map((issue: any, idx: number) => (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: 8,
                                      borderRadius: 6,
                                      background: isDarkMode ? '#0f172a' : '#ffffff',
                                      border: `1px solid ${cardBorder}`,
                                    }}
                                  >
                                    <Space style={{ marginBottom: 4 }}>
                                      <Tag color={issue.severity === 'CRITICAL' ? 'red' : issue.severity === 'HIGH' ? 'volcano' : 'orange'}>
                                        {issue.severity}
                                      </Tag>
                                      <Text strong style={{ fontSize: 12 }}>{issue.filePath}:{issue.lineNumber}</Text>
                                    </Space>
                                    <div style={{ fontSize: 12, color: isDarkMode ? '#cbd5e1' : '#475569' }}>
                                      {issue.message}
                                    </div>
                                    {issue.suggestedFix && (
                                      <pre
                                        style={{
                                          margin: '6px 0 0',
                                          padding: 6,
                                          fontSize: 11,
                                          background: isDarkMode ? '#020617' : '#f1f5f9',
                                          borderRadius: 4,
                                          overflowX: 'auto',
                                        }}
                                      >
                                        <code>{issue.suggestedFix}</code>
                                      </pre>
                                    )}
                                  </div>
                                ))}
                              </Space>
                            ),
                          },
                        ]}
                      />
                    )}

                    {rev.githubCommentUrl && (
                      <div style={{ marginTop: 10, textAlign: 'right' }}>
                        <Button
                          type="link"
                          size="small"
                          icon={<GithubOutlined />}
                          href={rev.githubCommentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Xem Comment trên GitHub PR
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </Space>
          )}
        </Drawer>
      </div>
    </ConfigProvider>
  );
}
