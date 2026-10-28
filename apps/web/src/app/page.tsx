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
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  CompassOutlined,
  ForkOutlined,
  ExpandAltOutlined,
  ApartmentOutlined as ApartmentIcon,
} from '@ant-design/icons';
import ArchitectureCanvas from '../components/ArchitectureCanvas';
import MarkdownRenderer from '../components/MarkdownRenderer';
import GitGraphTab from '../components/GitGraphTab';
import CommitHistoryTab from '../components/CommitHistoryTab';
import PRReviewHubTab from '../components/PRReviewHubTab';
import AIWorkspace, { type WorkspaceTab } from '../components/AIWorkspace';
import { ArchitectureGraph, IngestProgressEvent, CodeCitation, ActiveTabKey } from '@codelens/shared';
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
    initAuth().then(() => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const err = urlParams.get('error');
        const msg = urlParams.get('msg');
        const provider = urlParams.get('auth_provider');

        if (err) {
          message.warning(msg ? decodeURIComponent(msg) : 'Đăng nhập GitHub chưa hoàn tất.');
        } else if (provider === 'github') {
          message.success('Đăng nhập GitHub thành công!');
        }
      }
    });
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

  // ── Multi-Tab Dashboard & Layout State (Sprint 6) ──
  const [activeTab, setActiveTab] = useState<ActiveTabKey>('architecture');
  const [isChatCollapsed, setIsChatCollapsed] = useState<boolean>(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

  // ── AI Analysis Workspace State ──
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState<boolean>(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('explanation');
  const [workspaceMessageId, setWorkspaceMessageId] = useState<string | null>(null);

  // ── Responsive Window Width Detection ──
  const [windowWidth, setWindowWidth] = useState<number>(1400);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const w = window.innerWidth;
      setWindowWidth(w);
      if (w < 1024) {
        setIsSidebarCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);

  // Tự động cuộn trực tiếp container tin nhắn xuống đáy (không cuộn ancestor/window)
  useEffect(() => {
    const el = chatMessagesContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
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
        `Đã nạp kiến trúc: ${data.architectureGraph?.nodes?.length || 0} files và ${data.architectureGraph?.edges?.length || 0
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

    // Nếu đang mở Workspace, tự động hướng Workspace hiển thị tin nhắn mới này
    if (isWorkspaceOpen) {
      setWorkspaceMessageId(aiMessageId);
    }

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
          activeTab,
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
   * Tự động đặt câu hỏi phân tích nhánh Git và kích hoạt AI
   */
  const handleAskAIAboutBranch = (branchName: string) => {
    setIsChatCollapsed(false);
    const branchPrompt = `Phân tích nhánh Git "${branchName}": Nhánh này đang đi trước/sau bao nhiêu commit so với nhánh chính và tập trung sửa module nào?`;
    handleAskAI(branchPrompt);
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

  // Dynamic AI Persona theo Active Tab (Sprint 6)
  const getAIPersonaInfo = () => {
    switch (activeTab) {
      case 'architecture':
        return {
          title: 'AI Code Architect',
          role: 'Principal Software Architect',
          tag: 'AST & Graph',
          color: 'purple',
        };
      case 'gitgraph':
        return {
          title: 'AI Release Engineer',
          role: 'Git Topology & Branching',
          tag: 'Git Topology',
          color: 'cyan',
        };
      case 'commits':
        return {
          title: 'AI Diff Auditor',
          role: 'Commit History & Diff Hunks',
          tag: 'Commits & Diff',
          color: 'green',
        };
      case 'pr_reviews':
        return {
          title: 'AI Security Reviewer',
          role: 'Security & Code Reviewer',
          tag: 'PR Security Audit',
          color: 'volcano',
        };
      default:
        return {
          title: 'AI Code Architect',
          role: 'Software Architect',
          tag: 'Gemini 2.5 Flash',
          color: 'blue',
        };
    }
  };

  const persona = getAIPersonaInfo();

  // ── AI Workspace Helpers ──
  const extractMermaidFromText = (text: string): string | null => {
    if (!text) return null;
    const match = text.match(/```mermaid[\r\n\s]+([\s\S]*?)```/i);
    return match ? match[1].trim() : null;
  };

  const workspaceMessage =
    workspaceMessageId !== null
      ? (messages.find((m) => m.id === workspaceMessageId) ?? null)
      : (messages.filter((m) => m.sender === 'ai' && (m.text || m.isStreaming)).at(-1) ?? null);

  const workspaceMermaidCode = workspaceMessage
    ? extractMermaidFromText(workspaceMessage.text)
    : null;

  const handleOpenWorkspace = (messageId: string, tab: WorkspaceTab = 'explanation') => {
    setWorkspaceMessageId(messageId);
    setWorkspaceTab(tab);
    setIsWorkspaceOpen(true);
  };

  const handleMenuTabClick = (tabKey: ActiveTabKey) => {
    setActiveTab(tabKey);
    setIsWorkspaceOpen(false);
  };

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
          display: 'flex',
          flexDirection: 'row',
          height: '100dvh',
          maxHeight: '100dvh',
          width: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          background: bgMain,
          color: isDarkMode ? '#e2e8f0' : '#1e293b',
          transition: 'background-color 0.3s ease, color 0.3s ease',
        }}
      >
        {/* ── 1. Vertical Sidebar Glassmorphism Dashboard (Cố định chiều cao màn hình) ── */}
        <aside
          style={{
            width: isSidebarCollapsed ? 72 : 230,
            minWidth: isSidebarCollapsed ? 72 : 230,
            height: 'calc(100dvh - 20px)',
            maxHeight: 'calc(100dvh - 20px)',
            margin: '10px 0 10px 12px',
            boxSizing: 'border-box',
            borderRadius: 22,
            alignSelf: 'center',
            background: isDarkMode
              ? 'rgba(15, 23, 42, 0.72)'
              : 'rgba(255, 255, 255, 0.78)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: isDarkMode
              ? '1px solid rgba(255, 255, 255, 0.12)'
              : '1px solid rgba(0, 0, 0, 0.08)',
            boxShadow: isDarkMode
              ? '0 10px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.12)'
              : '0 10px 32px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.8)',
            display: 'flex',
            flexDirection: 'column',
            padding: isSidebarCollapsed ? '16px 8px' : '18px 14px',
            flexShrink: 0,
            zIndex: 30,
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            color: isDarkMode ? '#f8fafc' : '#0f172a',
            userSelect: 'none',
          }}
        >
          {/* Brand Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
              marginBottom: 14,
              paddingLeft: isSidebarCollapsed ? 0 : 4,
            }}
          >
            {isSidebarCollapsed ? (
              <span style={{ fontSize: 18, fontWeight: 800, color: isDarkMode ? '#f8fafc' : '#0f172a' }}>
                C
              </span>
            ) : (
              <span
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: '-0.3px',
                  color: isDarkMode ? '#f8fafc' : '#0f172a',
                }}
              >
                CodeLens
              </span>
            )}
          </div>

          {/* Thin Divider */}
          <div
            style={{
              height: 1,
              background: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.07)',
              marginBottom: 14,
            }}
          />

          {/* User Profile Card */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
              marginBottom: 14,
              padding: isSidebarCollapsed ? '2px 0' : '2px 4px',
            }}
          >
            <Avatar
              size={isSidebarCollapsed ? 36 : 38}
              src={user?.avatarUrl}
              style={{
                backgroundColor: '#0b0f17',
                border: `2px solid ${isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}`,
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
                fontSize: 13,
              }}
            >
              {user ? user.username.slice(0, 2).toUpperCase() : 'CL'}
            </Avatar>

            {!isSidebarCollapsed && (
              <div style={{ overflow: 'hidden', minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: isDarkMode ? '#f8fafc' : '#0f172a',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}
                >
                  {user ? user.username : 'Developer Guest'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: isDarkMode ? '#94a3b8' : '#64748b',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}
                >
                  {user ? (user.role === 'ADMIN' ? 'Admin Account' : 'My Account') : 'Guest Account'}
                </div>
              </div>
            )}
          </div>

          {/* Thin Divider */}
          <div
            style={{
              height: 1,
              background: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.07)',
              marginBottom: 14,
            }}
          />

          {/* MENU Label */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.8px',
              color: isDarkMode ? '#94a3b8' : '#64748b',
              textTransform: 'uppercase',
              marginBottom: 12,
              paddingLeft: isSidebarCollapsed ? 0 : 6,
              textAlign: isSidebarCollapsed ? 'center' : 'left',
            }}
          >
            MENU
          </div>

          {/* Menu Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto', paddingRight: 2 }}>
            {/* Item 1: Bản đồ AST */}
            <Tooltip title={isSidebarCollapsed ? 'Bản đồ AST' : ''} placement="right">
              <div
                onClick={() => handleMenuTabClick('architecture')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: isSidebarCollapsed ? '10px 0' : '9px 12px',
                  justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background:
                    activeTab === 'architecture' && !isWorkspaceOpen
                      ? isDarkMode
                        ? 'rgba(255, 255, 255, 0.14)'
                        : 'rgba(0, 0, 0, 0.08)'
                      : 'transparent',
                  color:
                    activeTab === 'architecture' && !isWorkspaceOpen
                      ? isDarkMode
                        ? '#ffffff'
                        : '#0f172a'
                      : isDarkMode
                        ? '#94a3b8'
                        : '#64748b',
                  fontWeight: activeTab === 'architecture' && !isWorkspaceOpen ? 600 : 500,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== 'architecture') {
                    e.currentTarget.style.background = isDarkMode
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#0f172a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== 'architecture') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = isDarkMode ? '#94a3b8' : '#64748b';
                  }
                }}
              >
                <ApartmentOutlined style={{ fontSize: 18 }} />
                {!isSidebarCollapsed && (
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Bản đồ AST</span>
                )}
              </div>
            </Tooltip>

            {/* Item 2: Nhánh Git */}
            <Tooltip title={isSidebarCollapsed ? 'Nhánh Git' : ''} placement="right">
              <div
                onClick={() => handleMenuTabClick('gitgraph')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: isSidebarCollapsed ? '10px 0' : '9px 12px',
                  justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background:
                    activeTab === 'gitgraph' && !isWorkspaceOpen
                      ? isDarkMode
                        ? 'rgba(255, 255, 255, 0.14)'
                        : 'rgba(0, 0, 0, 0.08)'
                      : 'transparent',
                  color:
                    activeTab === 'gitgraph' && !isWorkspaceOpen
                      ? isDarkMode
                        ? '#ffffff'
                        : '#0f172a'
                      : isDarkMode
                        ? '#94a3b8'
                        : '#64748b',
                  fontWeight: activeTab === 'gitgraph' && !isWorkspaceOpen ? 600 : 500,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== 'gitgraph') {
                    e.currentTarget.style.background = isDarkMode
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#0f172a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== 'gitgraph') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = isDarkMode ? '#94a3b8' : '#64748b';
                  }
                }}
              >
                <BranchesOutlined style={{ fontSize: 18 }} />
                {!isSidebarCollapsed && (
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Nhánh Git</span>
                )}
              </div>
            </Tooltip>

            {/* Item 3: Lịch sử Commit */}
            <Tooltip title={isSidebarCollapsed ? 'Lịch sử Commit' : ''} placement="right">
              <div
                onClick={() => handleMenuTabClick('commits')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: isSidebarCollapsed ? '10px 0' : '9px 12px',
                  justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                  borderRadius: 12,
                  cursor: 'pointer',
                  background:
                    activeTab === 'commits' && !isWorkspaceOpen
                      ? isDarkMode
                        ? 'rgba(255, 255, 255, 0.14)'
                        : 'rgba(0, 0, 0, 0.08)'
                      : 'transparent',
                  color:
                    activeTab === 'commits' && !isWorkspaceOpen
                      ? isDarkMode
                        ? '#ffffff'
                        : '#0f172a'
                      : isDarkMode
                        ? '#94a3b8'
                        : '#64748b',
                  fontWeight: activeTab === 'commits' && !isWorkspaceOpen ? 600 : 500,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== 'commits') {
                    e.currentTarget.style.background = isDarkMode
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#0f172a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== 'commits') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = isDarkMode ? '#94a3b8' : '#64748b';
                  }
                }}
              >
                <HistoryOutlined style={{ fontSize: 18 }} />
                {!isSidebarCollapsed && (
                  <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Lịch sử Commit</span>
                )}
              </div>
            </Tooltip>

            {/* Item 4: Đánh giá PR với badge tròn xanh nổi bật */}
            <Tooltip title={isSidebarCollapsed ? 'Đánh giá PR' : ''} placement="right">
              <div
                onClick={() => handleMenuTabClick('pr_reviews')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: isSidebarCollapsed ? '10px 0' : '9px 12px',
                  justifyContent: isSidebarCollapsed ? 'center' : 'space-between',
                  borderRadius: 12,
                  cursor: 'pointer',
                  position: 'relative',
                  background:
                    activeTab === 'pr_reviews' && !isWorkspaceOpen
                      ? isDarkMode
                        ? 'rgba(255, 255, 255, 0.14)'
                        : 'rgba(0, 0, 0, 0.08)'
                      : 'transparent',
                  color:
                    activeTab === 'pr_reviews' && !isWorkspaceOpen
                      ? isDarkMode
                        ? '#ffffff'
                        : '#0f172a'
                      : isDarkMode
                        ? '#94a3b8'
                        : '#64748b',
                  fontWeight: activeTab === 'pr_reviews' && !isWorkspaceOpen ? 600 : 500,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== 'pr_reviews') {
                    e.currentTarget.style.background = isDarkMode
                      ? 'rgba(255, 255, 255, 0.06)'
                      : 'rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.color = isDarkMode ? '#ffffff' : '#0f172a';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== 'pr_reviews') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = isDarkMode ? '#94a3b8' : '#64748b';
                  }
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ position: 'relative' }}>
                    <AuditOutlined style={{ fontSize: 18 }} />
                    {isSidebarCollapsed && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -4,
                          right: -6,
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#2563eb',
                          boxShadow: '0 0 6px rgba(37,99,235,0.8)',
                        }}
                      />
                    )}
                  </div>
                  {!isSidebarCollapsed && (
                    <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Đánh giá PR</span>
                  )}
                </div>

                {/* Badge tròn xanh dương chuẩn như hình mẫu */}
                {!isSidebarCollapsed && (
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: '#2563eb',
                      boxShadow: '0 2px 8px rgba(37, 99, 235, 0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {prReviews.length || 3}
                  </div>
                )}
              </div>
            </Tooltip>
          </div>

          {/* Thin Divider Trước Logout */}
          <div
            style={{
              height: 1,
              background: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.07)',
              margin: '14px 0',
            }}
          />

          {/* Log Out Button */}
          <Tooltip title={isSidebarCollapsed ? (user ? 'Đăng xuất' : 'Đăng nhập Demo') : ''} placement="right">
            <div
              onClick={() => {
                if (user) {
                  logout();
                  message.info('Đã đăng xuất.');
                  fetchRepositories();
                } else {
                  handleDemoLogin();
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: isSidebarCollapsed ? '10px 0' : '9px 12px',
                justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                borderRadius: 12,
                cursor: 'pointer',
                color: isDarkMode ? '#94a3b8' : '#64748b',
                fontWeight: 500,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isDarkMode
                  ? 'rgba(239, 68, 68, 0.15)'
                  : 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = isDarkMode ? '#94a3b8' : '#64748b';
              }}
            >
              <LogoutOutlined style={{ fontSize: 18 }} />
              {!isSidebarCollapsed && (
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  {user ? 'Log Out' : 'Demo Login'}
                </span>
              )}
            </div>
          </Tooltip>
        </aside>

        {/* ── 2. Khu vực chính bên phải: Header (chiều dài thu gọn) + Main Viewport + AI Chat ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            maxHeight: '100dvh',
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {/* ── Top Header Bar (Thu gọn chiều dài, chiếm không gian cố định như ban đầu, không đè nội dung) ── */}
          <header
            style={{
              padding: '10px 20px',
              background: cardBg,
              borderBottom: `1px solid ${cardBorder}`,
              boxShadow: isDarkMode ? '0 2px 10px rgba(0, 0, 0, 0.3)' : '0 1px 4px rgba(0, 0, 0, 0.04)',
              zIndex: 20,
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            <Row align="middle" justify="space-between" gutter={[16, 10]}>
              {/* Logo & Slogan */}
              <Col xs={24} lg={8}>
                <Space align="center" size={10}>
                  {/* Nút Hamburger Toggle Sidebar */}
                  <Tooltip title={isSidebarCollapsed ? 'Mở rộng Sidebar' : 'Thu gọn Sidebar'}>
                    <Button
                      type="text"
                      icon={<MenuOutlined style={{ fontSize: 18 }} />}
                      onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                      style={{
                        color: isDarkMode ? '#e2e8f0' : '#1e293b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
                      }}
                    />
                  </Tooltip>

                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ApartmentOutlined style={{ fontSize: 22, color: '#fff' }} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Title level={4} style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
                        CodeLens AI
                      </Title>
                      <Tag color="blue" style={{ fontSize: 11, padding: '0 6px', margin: 0, borderRadius: 4 }}>
                        v2.0
                      </Tag>
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      Bản đồ Kiến trúc AST, RAG & Auto PR Reviewer
                    </Text>
                  </div>
                </Space>
              </Col>

              {/* Khu vực Người dùng & Quota (Task TS-24) */}
              <Col xs={24} lg={16} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <Space size={14} wrap align="center">
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
                      onClick={() => handleMenuTabClick('pr_reviews')}
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
          </header>

          {/* ── Bố cục Nội dung: Main Viewport (Cuộn độc lập) & Khung Chat AI ── */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
              position: 'relative',
              boxSizing: 'border-box',
            }}
          >
            {/* ── 2. Vùng Trung Tâm (Main Viewport hoặc AI Workspace) ── */}
            {isWorkspaceOpen ? (
              <AIWorkspace
                message={workspaceMessage}
                mermaidCode={workspaceMermaidCode}
                activeTab={workspaceTab}
                onTabChange={setWorkspaceTab}
                onClose={() => setIsWorkspaceOpen(false)}
                repoName={repoMetadata ? `${repoMetadata.owner}/${repoMetadata.name}` : undefined}
                isDarkMode={isDarkMode}
                cardBg={cardBg}
                cardBorder={cardBorder}
                onCitationClick={(filePath) => setSelectedFile(filePath)}
                onAskForDiagram={(type) => {
                  let prompt = 'Vẽ sơ đồ tương tác giải thích chi tiết cho kiến trúc này.';
                  if (type === 'flowchart') {
                    prompt = 'Hãy phân tích và vẽ sơ đồ Mermaid Flowchart (flowchart TD) chi tiết các bước xử lý, rẽ nhánh điều kiện và luồng dữ liệu cho chức năng/module này để người dùng có thể kéo thả tương tác.';
                  } else if (type === 'sequence') {
                    prompt = 'Hãy vẽ sơ đồ tuần tự Sequence Diagram chi tiết thứ tự gọi hàm, API và database cho chức năng này.';
                  } else if (type === 'architecture') {
                    prompt = 'Hãy vẽ sơ đồ phân tầng kiến trúc tổng quan (Controller -> Service -> Model) bằng cú pháp Mermaid flowchart TD cho repository này.';
                  } else if (type === 'erd') {
                    prompt = 'Hãy phân tích cấu trúc dữ liệu và vẽ sơ đồ quan hệ thực thể (ERD / Data Model) bằng Mermaid cho các model trong repository này.';
                  }
                  handleAskAI(prompt);
                  setWorkspaceTab('diagram');
                }}
              />
            ) : (
              <main
                style={{
                  flex: 1,
                  height: '100%',
                  maxHeight: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  background: bgMain,
                  padding: '16px 20px',
                  boxSizing: 'border-box',
                }}
              >

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

                      <Button
                        size="small"
                        type={activeTab === 'pr_reviews' ? 'primary' : 'default'}
                        icon={<AuditOutlined />}
                        onClick={() => handleMenuTabClick('pr_reviews')}
                      >
                        PR Review Hub
                      </Button>
                    </Space>
                  </div>
                )}

                {/* ── Nội dung Viewport động theo 4 Tabs ── */}
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {activeTab === 'architecture' && (
                    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <ArchitectureCanvas
                        graph={graph}
                        selectedNodeId={selectedFile}
                        onSelectNode={(file) => setSelectedFile(file)}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  )}

                  {activeTab === 'gitgraph' && (
                    <GitGraphTab
                      repoId={repoId}
                      repoName={repoMetadata ? `${repoMetadata.owner}/${repoMetadata.name}` : undefined}
                      token={token}
                      isDarkMode={isDarkMode}
                      onAskAIAboutBranch={handleAskAIAboutBranch}
                    />
                  )}

                  {activeTab === 'commits' && (
                    <CommitHistoryTab
                      repoId={repoId}
                      repoName={repoMetadata ? `${repoMetadata.owner}/${repoMetadata.name}` : undefined}
                      token={token}
                      isDarkMode={isDarkMode}
                    />
                  )}

                  {activeTab === 'pr_reviews' && (
                    <PRReviewHubTab
                      repoId={repoId}
                      repoName={repoMetadata ? `${repoMetadata.owner}/${repoMetadata.name}` : undefined}
                      repoUrl={repoUrl}
                      token={token}
                      isDarkMode={isDarkMode}
                      userUsername={user?.username}
                      webhookActive={repoMetadata?.webhookActive || false}
                      onToggleWebhook={handleToggleWebhook}
                      togglingWebhook={togglingWebhook}
                    />
                  )}
                </div>
              </main>
            )} {/* end isWorkspaceOpen conditional */}

            {/* ── 3. Khung Chat AI bên phải (Collapsible Panel) ── */}
            <aside
              style={{
                width: isChatCollapsed ? 48 : (windowWidth < 1280 ? 350 : 410),
                minWidth: isChatCollapsed ? 48 : (windowWidth < 1280 ? 350 : 410),
                height: '100%',
                maxHeight: '100%',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                borderLeft: `1px solid ${cardBorder}`,
                background: cardBg,
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}
            >
              {isChatCollapsed ? (
                <div
                  style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '16px 0',
                    gap: 16,
                    cursor: 'pointer',
                  }}
                  onClick={() => setIsChatCollapsed(false)}
                >
                  <Tooltip title="Mở rộng Trợ lý AI" placement="left">
                    <Button
                      type="text"
                      icon={<MenuUnfoldOutlined style={{ fontSize: 18, color: '#38bdf8' }} />}
                    />
                  </Tooltip>
                  <RobotOutlined style={{ fontSize: 22, color: '#38bdf8' }} />
                  <div
                    style={{
                      writingMode: 'vertical-rl',
                      letterSpacing: 2,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#94a3b8',
                      marginTop: 8,
                    }}
                  >
                    TRỢ LÝ AI CODELENS
                  </div>
                </div>
              ) : (
                <Card
                  title={
                    <Space style={{ minWidth: 0, overflow: 'hidden', maxWidth: '100%' }} size={6}>
                      <RobotOutlined style={{ color: '#38bdf8', fontSize: 18, flexShrink: 0 }} />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {persona.title}
                      </span>
                      <Tag color={persona.color} style={{ fontSize: 10, margin: 0, flexShrink: 0 }}>
                        {persona.tag}
                      </Tag>
                    </Space>
                  }
                  extra={
                    <Space size={4} style={{ flexShrink: 0 }}>
                      {messages.length > 0 && (
                        <>
                          <Tooltip title="Mở Analysis Workspace">
                            <Button
                              size="small"
                              type="text"
                              icon={<ExpandAltOutlined style={{ fontSize: 13 }} />}
                              onClick={() => {
                                const lastAI = messages.filter((m) => m.sender === 'ai' && m.text).at(-1);
                                if (lastAI) handleOpenWorkspace(lastAI.id, 'explanation');
                                else setIsWorkspaceOpen(true);
                              }}
                              style={{ color: '#38bdf8', padding: '0 4px' }}
                            >
                              Workspace
                            </Button>
                          </Tooltip>
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
                              style={{ color: '#94a3b8', padding: '0 4px' }}
                            >
                              Xóa
                            </Button>
                          </Popconfirm>
                        </>
                      )}
                      <Tooltip title="Thu gọn Trợ lý AI">
                        <Button
                          size="small"
                          type="text"
                          icon={<MenuFoldOutlined style={{ fontSize: 16 }} />}
                          onClick={() => setIsChatCollapsed(true)}
                          style={{ padding: '0 4px' }}
                        />
                      </Tooltip>
                    </Space>
                  }
                  style={{
                    height: '100%',
                    minHeight: 0,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 0,
                    border: 'none',
                    background: cardBg,
                    boxSizing: 'border-box',
                  }}
                  styles={{
                    header: {
                      padding: '0 12px',
                      minHeight: 48,
                      flexShrink: 0,
                      borderBottom: `1px solid ${cardBorder}`,
                      overflow: 'hidden',
                    },
                    body: {
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      padding: '12px 14px',
                      boxSizing: 'border-box',
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
                        flexShrink: 0,
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

                  {/* Khung Hội Thoại Tin Nhắn */}
                  <div
                    ref={chatMessagesContainerRef}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      marginBottom: 12,
                      padding: '12px 10px',
                      background: isDarkMode ? '#020617' : '#f8fafc',
                      borderRadius: 8,
                      border: `1px solid ${cardBorder}`,
                      boxSizing: 'border-box',
                    }}
                  >
                    {messages.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '36px 12px', color: '#94a3b8' }}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 12,
                            background:
                              'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(124, 58, 237, 0.2))',
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
                          {persona.title}
                        </Text>
                        <div style={{ fontSize: 12, marginTop: 4, marginBottom: 18, color: '#94a3b8' }}>
                          Vai trò: <strong>{persona.role}</strong>. Hãy đặt bất kỳ câu hỏi nào về mã nguồn, nhánh hoặc Pull Request!
                        </div>

                        {/* Gợi ý câu hỏi nhanh */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380, margin: '0 auto' }}>
                          {[
                            activeTab === 'architecture'
                              ? 'Vẽ sơ đồ tương tác giữa các controllers và services?'
                              : activeTab === 'gitgraph'
                                ? 'Giải thích cấu trúc phân nhánh và các tính năng đang phát triển?'
                                : activeTab === 'commits'
                                  ? 'Tóm tắt các commit mới nhất và tác động lên hệ thống?'
                                  : 'Những rủi ro bảo mật chính trong các Pull Request gần đây?',
                            'Chức năng favorite hoạt động như thế nào?',
                            'Luồng xác thực và phân quyền người dùng?',
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
                                maxWidth: '100%',
                                minWidth: 0,
                                boxSizing: 'border-box',
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
                                  maxWidth: 'calc(100% - 36px)',
                                  minWidth: 0,
                                  wordBreak: 'break-word',
                                  overflowWrap: 'break-word',
                                  boxSizing: 'border-box',
                                }}
                              >
                                {msg.sender === 'user' ? (
                                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                                    {msg.text}
                                  </div>
                                ) : (
                                  <div>
                                    <MarkdownRenderer
                                      content={msg.text}
                                      isStreaming={msg.isStreaming}
                                      onCitationClick={(filePath) => setSelectedFile(filePath)}
                                      onOpenWorkspace={(code) => handleOpenWorkspace(msg.id, 'diagram')}
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
                                              style={{
                                                cursor: 'pointer',
                                                fontSize: 11,
                                                maxWidth: '100%',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                              }}
                                              onClick={() => setSelectedFile(c.filePath)}
                                            >
                                              {c.filePath}:L{c.startLine}-L{c.endLine}
                                            </Tag>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Nút mở Workspace (hiển thị sau khi streaming xong) */}
                                    {!msg.isStreaming && msg.text && (
                                      <div
                                        style={{
                                          marginTop: 8,
                                          paddingTop: 6,
                                          borderTop: `1px solid ${isDarkMode ? '#1e293b' : '#f1f5f9'}`,
                                          display: 'flex',
                                          gap: 4,
                                          flexWrap: 'wrap',
                                        }}
                                      >
                                        <Button
                                          size="small"
                                          type="text"
                                          icon={<ExpandAltOutlined style={{ fontSize: 11 }} />}
                                          onClick={() => handleOpenWorkspace(msg.id, 'explanation')}
                                          style={{
                                            fontSize: 11,
                                            padding: '0 6px',
                                            height: 22,
                                            color: '#38bdf8',
                                          }}
                                        >
                                          Giải thích
                                        </Button>
                                        {extractMermaidFromText(msg.text) && (
                                          <Button
                                            size="small"
                                            type="text"
                                            icon={<ApartmentIcon style={{ fontSize: 11 }} />}
                                            onClick={() => handleOpenWorkspace(msg.id, 'diagram')}
                                            style={{
                                              fontSize: 11,
                                              padding: '0 6px',
                                              height: 22,
                                              color: '#a78bfa',
                                            }}
                                          >
                                            Biểu đồ
                                          </Button>
                                        )}
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

                  {/* Ô nhập tin nhắn */}
                  <Space.Compact style={{ width: '100%', flexShrink: 0 }}>
                    <Input.TextArea
                      rows={2}
                      placeholder={`Hỏi ${persona.title} về ${persona.tag.toLowerCase()}...`}
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
              )}
            </aside>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
