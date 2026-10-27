# 02. Sơ đồ Tuần tự (System Sequence Diagrams)

Tài liệu này mô tả chi tiết luồng tương tác tuần tự giữa các thành phần trong 3 nghiệp vụ kỹ thuật phức tạp nhất của **CodeLens AI**.

---

## 1. Luồng Quét Repository Bất đồng bộ, Phân tích AST & Tạo Vector (Ingestion Pipeline)

**Điểm nhấn kỹ thuật:**
* **Non-blocking Response:** API trả về `202 Accepted` ngay lập tức và đẩy tác vụ nặng xuống **BullMQ Worker**.
* **Real-time Progress:** Cập nhật tiến độ phần trăm (%) thời gian thực về Frontend qua **Server-Sent Events (SSE)**.
* **In-Memory AST Parsing:** Sử dụng `ts-morph` phân tích cú pháp trên RAM, tạo đồ thị `Nodes & Edges` và cắt nhỏ mã nguồn theo từng hàm/class.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 👨‍💻 Developer
    participant FE as 🖥️ Next.js Client
    participant API as ⚙️ Express API
    participant Queue as 📨 Redis + BullMQ
    participant Worker as 👷 Ingestion Worker
    participant GH as 🐙 GitHub API
    participant AI as ✨ Gemini Embedding
    participant DB as 🍃 MongoDB Atlas

    Dev->>FE: Dán GitHub Repo URL & Bấm "Phân tích AST"
    FE->>API: POST /api/repos/ingest { repoUrl }
    
    API->>GH: Kiểm tra Repo tồn tại & Lấy metadata
    GH-->>API: 200 OK (Repo hợp lệ, kích thước < 10MB)
    
    API->>DB: Tạo bản ghi Repo (status: PENDING)
    API->>Queue: Đẩy Job "ingest-repo" { repoId, repoUrl }
    API-->>FE: 202 Accepted { repoId, jobId }
    
    FE->>API: Mở kết nối SSE (GET /api/repos/:id/stream-status)
    
    Queue->>Worker: Kích hoạt Worker xử lý Job
    Worker-->>FE: [SSE] Tiến độ 10%: Đang tải cây thư mục...
    
    Worker->>GH: Lấy Git Tree & Nội dung các file code (.ts, .tsx, .js, .jsx)
    Note over Worker,GH: Bỏ qua node_modules, dist, .lock, ảnh, test files
    GH-->>Worker: Trả về danh sách Raw Code Files
    
    Worker-->>FE: [SSE] Tiến độ 40%: Đang phân tích AST & Đồ thị...
    
    loop Duyệt qua từng File bằng AST Parser (ts-morph)
        Worker->>Worker: 1. Trích xuất lệnh import/export -> Tạo Nodes & Edges
        Worker->>Worker: 2. Cắt nhỏ (Chunking) theo từng Function / Class / Component
    end
    
    Worker-->>FE: [SSE] Tiến độ 70%: Đang tạo Vector Embeddings...
    
    Worker->>AI: Gửi Batch Code Chunks (text-embedding-004)
    AI-->>Worker: Trả về mảng Vectors (768 chiều)
    
    Worker->>DB: 1. Lưu Architecture Graph (Nodes & Edges) vào collection `repositories`
    Worker->>DB: 2. Bulk Insert (Code Chunks + Vectors) vào collection `code_chunks`
    Worker->>DB: 3. Cập nhật trạng thái Repo -> COMPLETED
    
    Worker-->>FE: [SSE] Tiến độ 100%: Hoàn tất! Đóng kết nối SSE
    FE->>Dev: Tự động render Đồ thị React Flow & Mở khung Chat
```

---

## 2. Luồng Hỏi đáp Code-Aware RAG, Hybrid Search & Sinh sơ đồ trực tiếp

**Điểm nhấn kỹ thuật:**
* **Semantic Caching (Redis):** Trả về kết quả tức thì (`<50ms`) nếu câu hỏi đã từng được hỏi trên cùng một Repository.
* **Graph-Expanded Retrieval:** Kết hợp kết quả từ `$vectorSearch` với việc truy xuất mở rộng các file nằm trong danh sách `dependencies` của đoạn code đó.
* **Streaming Text & Mermaid Diagram:** Vừa stream câu trả lời văn bản, vừa tự động vẽ biểu đồ luồng và gắn thẻ trích dẫn dòng code.

```mermaid
sequenceDiagram
    autonumber
    actor User as 👨‍💻 User / Recruiter
    participant FE as 🖥️ Next.js (UI + React Flow)
    participant API as ⚙️ Express RAG Controller
    participant Cache as ⚡ Redis Cache
    participant AI as ✨ Gemini 2.5 Flash
    participant DB as 🍃 MongoDB Atlas (Vector + Graph)

    User->>FE: Nhập câu hỏi (VD: "Luồng xác thực JWT hoạt động thế nào?")
    FE->>API: POST /api/repos/:id/chat { question, selectedFile }
    
    API->>Cache: Kiểm tra Hash câu hỏi trong Redis Cache
    
    alt Có trong Cache (Cache Hit)
        Cache-->>API: Trả về câu trả lời đã lưu
        API-->>FE: [SSE] Stream ngay kết quả (Độ trễ < 50ms)
    else Không có trong Cache (Cache Miss)
        API->>AI: Tạo Vector cho câu hỏi (text-embedding-004)
        AI-->>API: Query Vector [768 chiều]
        
        API->>DB: 1. Vector Search ($vectorSearch + Pre-filter theo repoId)
        DB-->>API: Trả về Top 5 Code Chunks khớp ngữ nghĩa nhất
        
        API->>DB: 2. Graph Expansion: Lấy thêm các hàm/file được import bởi Top 5 Chunks
        DB-->>API: Trả về ngữ cảnh mở rộng (Related Dependencies)
        
        API->>API: Đóng gói System Prompt (Kèm Code + Số dòng + Yêu cầu xuất Mermaid)
        
        API->>AI: Gọi generateContentStream (Gemini 2.5 Flash)
        
        loop Streaming từng Token qua SSE
            AI-->>API: Token chunk
            API-->>FE: [SSE] Đẩy text chunk + Citations + Khối code Mermaid
            FE->>FE: Render Markdown, Vẽ sơ đồ Mermaid & Gắn nút Citation
        end
        
        API->>Cache: Lưu câu trả lời vào Redis (TTL: 24h)
    end
    
    User->>FE: Click vào Citation (VD: `auth.service.ts:L45-L88`)
    FE->>FE: Highlight Node trên React Flow & Cuộn Code Viewer tới dòng 45
```

---

## 3. Luồng Tự động Review Pull Request qua GitHub Webhook (Impact-Aware PR Reviewer)

**Điểm nhấn kỹ thuật:**
* **HMAC-SHA256 Verification:** Xác thực chữ ký bảo mật từ GitHub trước khi xử lý.
* **Cross-File Impact Analysis:** Không chỉ đọc đoạn `git diff` đơn lẻ, hệ thống tra cứu trong MongoDB xem file vừa sửa đang được gọi bởi những module nào khác để cảnh báo lỗi dây chuyền (Breaking Changes).

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 👨‍💻 Developer
    participant GH as 🐙 GitHub System
    participant API as ⚙️ Express Webhook Route
    participant Queue as 📨 Redis + BullMQ
    participant Worker as 👷 PR Review Worker
    participant DB as 🍃 MongoDB Atlas
    participant AI as ✨ Gemini 2.5 Flash

    Dev->>GH: Tạo hoặc cập nhật Pull Request (PR Opened / Synchronize)
    GH->>API: POST /api/webhooks/github (Header: X-Hub-Signature-256)
    
    API->>API: Xác thực chữ ký HMAC-SHA256 với GITHUB_WEBHOOK_SECRET
    API->>Queue: Đẩy Job "review-pr" { repoFullName, prNumber, diffUrl }
    API-->>GH: 202 Accepted (Phản hồi nhanh trong < 200ms)
    
    Queue->>Worker: Kích hoạt Worker phân tích PR
    Worker->>GH: Lấy nội dung thay đổi (Git Diff / Patch) của các files trong PR
    GH-->>Worker: Trả về danh sách Modified Files & Diff Hunks
    
    Worker->>DB: Truy vấn các Code Chunks đang import các file bị sửa (Impact Analysis)
    DB-->>Worker: Trả về danh sách Dependent Modules
    
    Worker->>AI: Gửi Prompt (Git Diff + Dependent Modules) yêu cầu chấm Risk Score & Tìm Bug
    AI-->>Worker: Trả về JSON { riskScore, mermaidSummary, issues[] }
    
    Worker->>GH: POST /repos/:owner/:repo/issues/:prNumber/comments (Đăng báo cáo Review)
    GH-->>Worker: 201 Created (Trả về githubCommentUrl)
    
    Worker->>DB: Lưu lịch sử vào collection `pr_reviews` để hiển thị lên Dashboard
```