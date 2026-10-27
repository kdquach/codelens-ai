# ─────────────────────────────────────────────────────────────
# Stage 1: Build Image
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Cài đặt các gói hệ thống cần thiết (nếu có native builds)
RUN apk add --no-cache libc6-compat python3 make g++

# Copy cấu hình package & monorepo files
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Cài đặt toàn bộ dependencies bao gồm cả devDependencies để build
RUN npm ci

# Biên dịch mã nguồn TypeScript của Server sang JavaScript (dist)
WORKDIR /app/apps/server
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 2: Production Runner Image
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Thiết lập môi trường Production
ENV NODE_ENV=production
ENV PORT=4000

# Tạo nhóm và người dùng không có đặc quyền root để bảo mật
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 expressjs

# Copy mã nguồn đã build và node_modules từ builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

USER expressjs

WORKDIR /app/apps/server

EXPOSE 4000

# Khởi chạy Express Server
CMD ["node", "dist/server.js"]

