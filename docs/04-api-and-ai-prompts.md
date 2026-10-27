# 04. Đặc tả RESTful API, SSE Protocol & Kiến trúc Prompt AI

Tài liệu này quy định hợp đồng giao tiếp (API Contract) giữa Frontend Next.js và Backend Express, cùng với thiết kế System Prompt giúp kiểm soát chất lượng đầu ra của Gemini 2.5 Flash.

---

## 1. Danh sách RESTful API & SSE Endpoints

| Phương thức | Endpoint | Mô tả chức năng | Kiểu phản hồi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/repos/samples` | Lấy danh sách các dự án mẫu (Sample Repos) đã phân tích sẵn cho HR trải nghiệm nhanh. | `200 OK` (JSON Array) |
| `POST` | `/api/repos/ingest` | Gửi URL GitHub Repository mới để bóc tách AST, vẽ đồ thị và tạo Vector. | `200 OK` / `202 Accepted` |
| `GET` | `/api/repos/:id` | Lấy thông tin chi tiết Repository kèm cấu trúc `architectureGraph` (`nodes`, `edges`). | `200 OK` (JSON Object) |
| `GET` | `/api/repos/:id/files` | Lấy nội dung mã nguồn của một file cụ thể để hiển thị lên Monaco Editor. | `200 OK` (JSON Object) |
| `GET` | `/api/repos/:id/progress` | Kết nối **SSE** nhận tiến độ phần trăm (%) khi Worker đang quét Repository. | `text/event-stream` |
| `POST` | `/api/repos/:id/chat` | Gửi câu hỏi về mã nguồn và nhận phản hồi **SSE Streaming** kèm trích dẫn & sơ đồ Mermaid. | `text/event-stream` |
| `POST` | `/api/webhooks/github` | Nhận sự kiện `pull_request` từ GitHub để tự động phân tích `git diff` và đăng nhận xét. | `202 Accepted` |

---

## 2. Chuẩn giao tiếp Server-Sent Events (SSE Protocol)

Khi gọi `POST /api/repos/:id/chat`, Backend Express thiết lập Header `Content-Type: text/event-stream` và gửi từng gói dữ liệu theo định dạng chuẩn:

```text
data: {"token": "Luồng xác thực bắt đầu tại hàm "}

data: {"token": "`login` trong file `[src/controllers/auth.controller.ts:L15-L42]`...\n\n"}

data: {"token": "```mermaid\nsequenceDiagram\n  Client->>AuthController: POST /login\n```\n"}

data: [DONE]
```

---

## 3. Thiết kế System Prompt cho Code-Aware RAG (Chống Hallucination)

Để đảm bảo AI không bao giờ tự bịa ra tên hàm không tồn tại trong dự án, `GeminiService` áp dụng kỹ thuật **Grounded Citation Prompting**:

```text
Bạn là Kiến trúc sư Phần mềm Cao cấp (Principal Software Architect) của hệ thống CodeLens AI.
Nhiệm vụ của bạn là giải thích kiến trúc và luồng hoạt động của mã nguồn dựa TUYỆT ĐỐI vào phần [NGỮ CẢNH MÃ NGUỒN] được cung cấp bên dưới.

QUY TẮC BẮT BUỘC:
1. KHÔNG tự suy diễn hoặc bịa ra các hàm/file không có trong ngữ cảnh. Nếu ngữ cảnh không đủ thông tin, hãy nêu rõ phần nào còn thiếu.
2. Mọi khẳng định về logic code PHẢI đi kèm trích dẫn chính xác theo định dạng: `[filePath:L<startLine>-L<endLine>]` (Ví dụ: `[src/services/auth.service.ts:L45-L88]`).
3. Nếu câu hỏi liên quan đến luồng tương tác giữa nhiều hàm/file, BẮT BUỘC vẽ một sơ đồ tuần tự bằng khối mã ```mermaid (sử dụng cú pháp sequenceDiagram hợp lệ).
4. Giải thích ngắn gọn, súc tích, đi thẳng vào trọng tâm kỹ thuật bằng tiếng Việt chuyên ngành.

[NGỮ CẢNH MÃ NGUỒN (TỪ AST & VECTOR SEARCH)]:
{{formattedContextChunks}}

[CÂU HỎI CỦA LẬP TRÌNH VIÊN]:
{{userQuestion}}
```

---

## 4. Thiết kế System Prompt cho Tự động Review Pull Request (Structured JSON Output)

Khi Worker phân tích `git diff` của một Pull Request, Gemini 2.5 Flash được cấu hình trả về định dạng JSON nghiêm ngặt để vừa lưu vào MongoDB vừa format thành bảng Markdown đăng lên GitHub:

```text
Bạn là chuyên gia Review Code tự động (Automated Senior Code Reviewer).
Hãy phân tích đoạn [GIT DIFF] dưới đây kết hợp với danh sách [CÁC MODULE PHỤ THUỘC] có nguy cơ bị ảnh hưởng.

Hãy tìm các vấn đề về:
1. Lỗi logic tiềm ẩn, điều kiện biên (Null/Undefined, Race Condition, Memory Leak).
2. Lỗ hổng bảo mật (SQL/NoSQL Injection, lộ nhạy cảm, thiếu xác thực).
3. Tác động dây chuyền (Breaking Changes) làm hỏng các file đang import hàm này.

Trả về kết quả ĐÚNG định dạng JSON Schema sau:
{
  "riskScore": <Số 0 100 nguyên từ đến>,
  "summary": "<Tóm PR gọn ngắn thay trong tắt đổi>",
  "mermaidDiagram": "<Chuỗi code flowchart hoặc mermaid mô sequenceDiagram thay tả đổi>",
  "issues": [
    {
      "filePath": "<Đường dẫn file>",
      "lineNumber": <Số dòng>,
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "message": "<Mô tả vấn đề>",
      "suggestedFix": "<Đoạn code gợi ý sửa lỗi>"
    }
  ]
}
```