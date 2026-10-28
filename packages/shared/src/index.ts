export type NodeCategory = 'controller' | 'service' | 'model' | 'component' | 'util' | 'other';

export interface GraphNode {
  id: string;          // VD: "src/services/auth.service.ts"
  label: string;       // VD: "auth.service.ts"
  category: NodeCategory;
  loc: number;         // Số dòng code
}

export interface GraphEdge {
  id: string;          // VD: "src/a.ts->src/b.ts"
  source: string;
  target: string;
}

export interface ArchitectureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CodeCitation {
  filePath: string;
  symbolName: string;
  startLine: number;
  endLine: number;
}

export interface IngestProgressEvent {
  repoId: string;
  progress: number;
  step: 'FETCHING' | 'PARSING_AST' | 'EMBEDDING' | 'COMPLETED' | 'FAILED';
  message: string;
}

// ─────────────────────────────────────────────────────────────
// PR Review & Webhook Types (Sprint 4 - Task TS-16, TS-17)
// ─────────────────────────────────────────────────────────────

export type PRIssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PRIssue {
  filePath: string;
  lineNumber: number;
  severity: PRIssueSeverity;
  message: string;
  suggestedFix?: string;
}

export interface PRReviewResult {
  riskScore: number;
  summary: string;
  mermaidDiagram: string;
  issues: PRIssue[];
  impactedFiles: string[];
}

export interface PRReviewRecord {
  id: string;
  repoId: string;
  prNumber: number;
  title: string;
  author: string;
  riskScore: number;
  status: 'REVIEWING' | 'COMMENTED' | 'FAILED';
  summary?: string;
  mermaidSummary?: string;
  issues: PRIssue[];
  impactedFiles?: string[];
  githubCommentUrl?: string;
  errorMessage?: string;
  createdAt: string | Date;
}

// ─────────────────────────────────────────────────────────────
// User & Auth Types (Sprint 5 - Task TS-20)
// ─────────────────────────────────────────────────────────────

export type UserRole = 'GUEST' | 'DEVELOPER' | 'ADMIN';

export interface UserQuota {
  dailyReposLeft: number;
  dailyQueriesLeft: number;
  lastResetAt: string | Date;
}

export interface UserProfile {
  id: string;
  githubId: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  quota: UserQuota;
  createdAt: string | Date;
}

// ─────────────────────────────────────────────────────────────
// Chat Session Types (Sprint 5 - Task TS-22)
// ─────────────────────────────────────────────────────────────

export interface ChatMessageDTO {
  role: 'user' | 'assistant';
  content: string;
  citations?: CodeCitation[];
  mermaidCode?: string;
  createdAt: string | Date;
}

export interface ChatSessionDTO {
  id: string;
  repoId: string;
  userId?: string;
  title?: string;
  messages: ChatMessageDTO[];
  updatedAt: string | Date;
  createdAt: string | Date;
}

// ─────────────────────────────────────────────────────────────
// Multi-Tab Dashboard & Git Types (Sprint 6)
// ─────────────────────────────────────────────────────────────

export type ActiveTabKey = 'architecture' | 'gitgraph' | 'commits' | 'pr_reviews';

export interface GitBranchDTO {
  name: string;
  commitSha: string;
  isDefault?: boolean;
  protected?: boolean;
}

export interface GitCommitDTO {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorEmail?: string;
  authorAvatarUrl?: string;
  date: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  parents?: string[];
}

export interface CommitFileChangeDTO {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface CommitDiffDTO {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorAvatarUrl?: string;
  date: string;
  stats: {
    additions: number;
    deletions: number;
    total: number;
  };
  files: CommitFileChangeDTO[];
  summary?: string;
}

