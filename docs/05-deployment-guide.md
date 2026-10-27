# Hướng dẫn Triển khai Hệ thống CodeLens AI (Deployment Guide)

> **Mã công việc:** Task TS-18 & TS-19  
> **Kiến trúc:** Next.js 15 (Frontend) + Express TypeScript (Backend) + MongoDB Atlas + Redis & BullMQ + Google Gemini 2.5 Flash

---

## 1. Danh sách Biến Môi trường (Environment Variables)

### 1.1 Backend Express API (`apps/server/.env`)

| Tên biến | Mô tả | Mẫu giá trị |
| :--- | :--- | :--- |
| `PORT` | Cổng HTTP lắng nghe của Express API | `4000` |
| `MONGODB_URI` | Chuỗi kết nối MongoDB Atlas | `mongodb+srv://user:pass@cluster.mongodb.net/codelens_db?retryWrites=true&w=majority` |
| `REDIS_URL` | URL kết nối Redis cho BullMQ Queue | `redis://localhost:6379` hoặc `rediss://...` |
| `GEMINI_API_KEY` | Khóa API Gemini từ Google AI Studio | `AIzaSy...` |
| `GITHUB_TOKEN` | GitHub Personal Access Token (PAT) | `ghp_...` (Scopes: `repo`, `read:org`) |
| `GITHUB_WEBHOOK_SECRET` | Khóa bí mật ký số HMAC-SHA256 Webhook | `codelens_webhook_secret_2026` |

### 1.2 Frontend Next.js (`apps/web/.env.production`)

| Tên biến | Mô tả | Mẫu giá trị |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Địa chỉ Backend API cho Web gọi | `https://codelens-api.onrender.com/api` |

---

## 2. Triển khai Frontend lên Vercel (Task TS-19)

### Cách 1: Triển khai qua Vercel Dashboard (Khuyên dùng)
1. Đăng nhập vào [Vercel Dashboard](https://vercel.com).
2. Bấm **Add New** $\rightarrow$ **Project** $\rightarrow$ Chọn Repository `codelens-ai`.
3. Cấu hình các thông số sau:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** Chọn `apps/web` (hoặc để trống nếu dùng `vercel.json` ở root)
   - **Build Command:** `npm run build`
   - **Output Directory:** `.next`
   - **Install Command:** `npm install`
4. Trong mục **Environment Variables**, thêm:
   - `NEXT_PUBLIC_API_URL`: Điền URL Backend Express của bạn (ví dụ: `https://codelens-api.onrender.com/api`).
5. Bấm **Deploy**. Vercel sẽ tự động build và cấp phát domain HTTPS miễn phí.

---

## 3. Triển khai Backend lên Render qua Render Blueprint (Task TS-19)

Hệ thống đã chuẩn bị sẵn file [render.yaml](file:///Users/kd.quach03/Documents/MyProjects/codelens-ai/render.yaml) để tự động hóa toàn bộ việc tạo 3 dịch vụ:

1. **Web Service (`codelens-api`):** Tiếp nhận HTTP requests, Webhook từ GitHub và SSE Stream.
2. **Worker (`codelens-worker`):** Tiến trình ngầm xử lý phân tích AST và review PR qua BullMQ.
3. **Redis (`codelens-redis`):** Dịch vụ hàng đợi và cache.

### Các bước triển khai:
1. Đăng nhập vào [Render.com](https://render.com).
2. Vào **Blueprints** $\rightarrow$ Chọn **New Blueprint Instance**.
3. Kết nối với GitHub Repository `codelens-ai`.
4. Render sẽ đọc file `render.yaml` và liệt kê các service cần tạo.
5. Điền các Environment Variables bí mật được yêu cầu:
   - `MONGODB_URI`
   - `GEMINI_API_KEY`
   - `GITHUB_TOKEN`
   - `GITHUB_WEBHOOK_SECRET`
6. Bấm **Apply**. Sau khoảng 2-3 phút, Backend API sẽ hoạt động tại địa chỉ: `https://codelens-api.onrender.com`.

---

## 4. Triển khai Độc lập trên VPS qua Docker Compose (Task TS-19)

Cấu hình sẵn sàng phục vụ Production trên Ubuntu/Debian VPS với Docker và Nginx Reverse Proxy.

### 4.1 Chuẩn bị trên VPS:
```bash
# Cài đặt Docker & Docker Compose
sudo apt-get update
sudo apt-get install -y docker.io docker-compose git

# Clone repository
git clone https://github.com/kdquach/codelens-ai.git
cd codelens-ai

# Tạo file .env cho production
cat << 'EOF' > .env
PORT=4000
MONGODB_URI=mongodb+srv://<user>:<pwd>@cluster.mongodb.net/codelens_db
REDIS_PASSWORD=codelens_super_secure_pass_2026
GEMINI_API_KEY=AIzaSy...
GITHUB_TOKEN=ghp_...
GITHUB_WEBHOOK_SECRET=your_secret_token_here
EOF
```

### 4.2 Khởi chạy hệ thống:
```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

Kiểm tra trạng thái các container:
```bash
docker-compose -f docker-compose.prod.yml ps
```

---

## 5. Cấu hình GitHub Webhook tự động Review PR (Task TS-16 & TS-17)

### 5.1 Cấu hình trên GitHub Repository:
1. Mở trang Repository của bạn trên GitHub (hoặc repo công ty muốn tích hợp review tự động).
2. Vào **Settings** $\rightarrow$ **Webhooks** $\rightarrow$ **Add webhook**.
3. Cấu hình các trường:
   - **Payload URL:** `https://your-api-domain.com/api/webhooks/github` (hoặc ngrok URL khi test nội bộ: `https://xxxx.ngrok-free.app/api/webhooks/github`)
   - **Content type:** `application/json`
   - **Secret:** Nhập chính xác chuỗi đã cấu hình trong `GITHUB_WEBHOOK_SECRET`.
   - **SSL verification:** Bật `Enable SSL verification`.
   - **Which events would you like to trigger this webhook?**
     - Chọn *Let me select individual events*.
     - Tích chọn: **Pull requests**.
4. Bấm **Add webhook**. GitHub sẽ gửi một request `ping`, hệ thống phản hồi `200 OK` với thông điệp:
   ```json
   { "status": "OK", "message": "Pong! CodeLens AI Webhook is configured successfully." }
   ```

### 5.2 Kiểm thử mô phỏng nhanh không cần mở port (Local Simulation):
Nếu bạn đang chạy thử nghiệm trên máy cục bộ và chưa có Public Webhook URL, bạn có thể gọi endpoint mô phỏng:
```bash
curl -X POST http://localhost:4000/api/webhooks/simulate-pr \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/kdquach/CafeVibe",
    "prNumber": 15,
    "title": "Refactor Order & Payment Security",
    "author": "developer"
  }'
```
Hệ thống sẽ ngay lập tức:
1. Đẩy job vào BullMQ.
2. Worker bóc tách thay đổi và phân tích Impact Analysis.
3. Gemini 2.5 Flash đánh giá rủi ro, tạo sơ đồ Mermaid và sinh báo cáo review.
4. Lưu vào database và hiển thị trực tiếp trên giao diện Web Dashboard!

---

## 6. Nạp Dữ liệu Mẫu cho HR & Đánh giá (Task TS-18)

Hệ thống có cơ chế tự động phát hiện và nạp dữ liệu mẫu (Auto-seed) khi khởi động Server nếu chưa có dữ liệu. Để chủ động chạy lại script nạp dữ liệu:

```bash
cd apps/server
npm run seed
```

**Dữ liệu mẫu nạp sẵn:**
1. **CafeVibe (`kdquach/CafeVibe`):** 12 node kiến trúc hoàn chỉnh (Controller, Service, Model, Component), 12 liên kết, các code chunk có embedding 768 chiều, và 1 bản ghi review mẫu cho PR #12 với Risk Score 68/100, sơ đồ Mermaid và danh sách 3 lỗ hổng phát hiện.
2. **Zod (`colinhacks/zod`):** Kiến trúc bóc tách thư viện xác thực TypeScript.
3. **Express.js (`expressjs/express`):** Kiến trúc router và pipeline middleware.

