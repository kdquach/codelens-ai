// apps/server/src/scripts/seed-samples.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/database';
import { RepositoryModel } from '../models/repository.model';
import { CodeChunkModel } from '../models/codeChunk.model';
import { PRReviewModel } from '../models/prReview.model';

// Helper tạo vector 768 chiều giả lập có phân bổ cosine đồng nhất
function createMockEmbedding(seed: number): number[] {
  const vector: number[] = [];
  let sumSq = 0;
  for (let i = 0; i < 768; i++) {
    const val = Math.sin(seed * (i + 1)) * Math.cos((seed + 1) * (i + 2));
    vector.push(val);
    sumSq += val * val;
  }
  const magnitude = Math.sqrt(sumSq) || 1;
  return vector.map((v) => Number((v / magnitude).toFixed(6)));
}

export async function seedSampleRepositories(): Promise<void> {
  console.log('🌱 [Seeder] Đang kiểm tra và khởi tạo dữ liệu mẫu (Sample Repositories)...');

  await connectDB();

  // ─────────────────────────────────────────────────────────────
  // 1. REPOSITORY MẪU: CafeVibe (Fullstack Restaurant App)
  // ─────────────────────────────────────────────────────────────
  const cafeVibeUrl = 'https://github.com/kdquach/CafeVibe';
  let cafeVibe = await RepositoryModel.findOne({ repoUrl: cafeVibeUrl });

  const cafeVibeGraph = {
    nodes: [
      { id: 'src/controllers/auth.controller.ts', label: 'auth.controller.ts', category: 'controller' as const, loc: 145 },
      { id: 'src/controllers/order.controller.ts', label: 'order.controller.ts', category: 'controller' as const, loc: 180 },
      { id: 'src/controllers/menu.controller.ts', label: 'menu.controller.ts', category: 'controller' as const, loc: 120 },
      { id: 'src/services/auth.service.ts', label: 'auth.service.ts', category: 'service' as const, loc: 210 },
      { id: 'src/services/order.service.ts', label: 'order.service.ts', category: 'service' as const, loc: 295 },
      { id: 'src/services/payment.service.ts', label: 'payment.service.ts', category: 'service' as const, loc: 190 },
      { id: 'src/models/user.model.ts', label: 'user.model.ts', category: 'model' as const, loc: 85 },
      { id: 'src/models/order.model.ts', label: 'order.model.ts', category: 'model' as const, loc: 95 },
      { id: 'src/models/menuItem.model.ts', label: 'menuItem.model.ts', category: 'model' as const, loc: 70 },
      { id: 'src/utils/jwt.util.ts', label: 'jwt.util.ts', category: 'util' as const, loc: 55 },
      { id: 'src/utils/logger.util.ts', label: 'logger.util.ts', category: 'util' as const, loc: 40 },
      { id: 'src/components/OrderSummary.tsx', label: 'OrderSummary.tsx', category: 'component' as const, loc: 110 },
    ],
    edges: [
      { id: 'e1', source: 'src/controllers/auth.controller.ts', target: 'src/services/auth.service.ts' },
      { id: 'e2', source: 'src/services/auth.service.ts', target: 'src/models/user.model.ts' },
      { id: 'e3', source: 'src/services/auth.service.ts', target: 'src/utils/jwt.util.ts' },
      { id: 'e4', source: 'src/controllers/order.controller.ts', target: 'src/services/order.service.ts' },
      { id: 'e5', source: 'src/controllers/order.controller.ts', target: 'src/services/payment.service.ts' },
      { id: 'e6', source: 'src/services/order.service.ts', target: 'src/models/order.model.ts' },
      { id: 'e7', source: 'src/services/order.service.ts', target: 'src/models/menuItem.model.ts' },
      { id: 'e8', source: 'src/services/order.service.ts', target: 'src/services/payment.service.ts' },
      { id: 'e9', source: 'src/controllers/menu.controller.ts', target: 'src/models/menuItem.model.ts' },
      { id: 'e10', source: 'src/components/OrderSummary.tsx', target: 'src/models/order.model.ts' },
      { id: 'e11', source: 'src/services/payment.service.ts', target: 'src/utils/logger.util.ts' },
      { id: 'e12', source: 'src/services/order.service.ts', target: 'src/utils/logger.util.ts' },
    ],
  };

  if (!cafeVibe) {
    cafeVibe = await RepositoryModel.create({
      owner: 'kdquach',
      name: 'CafeVibe',
      repoUrl: cafeVibeUrl,
      status: 'COMPLETED',
      isSample: true,
      description: 'Hệ thống Quản lý và Đặt bàn Cafe Fullstack (Node.js/Express + Next.js + MongoDB + Zod)',
      summary: 'Ứng dụng CafeVibe được kiến trúc theo mô hình Layered Architecture: Controller tiếp nhận request, Service xử lý business logic và Payment Gateway, Data Model đảm bảo Schema trong MongoDB.',
      architectureGraph: cafeVibeGraph,
    });
    console.log('✅ [Seeder] Đã tạo Repository CafeVibe');
  } else {
    cafeVibe.architectureGraph = cafeVibeGraph;
    cafeVibe.isSample = true;
    cafeVibe.status = 'COMPLETED';
    await cafeVibe.save();
    console.log('🔄 [Seeder] Đã cập nhật Repository CafeVibe');
  }

  // Seed Code Chunks cho CafeVibe
  await CodeChunkModel.deleteMany({ repoId: cafeVibe._id });
  const cafeVibeChunks = [
    {
      repoId: cafeVibe._id,
      filePath: 'src/services/payment.service.ts',
      symbolName: 'processPaymentWebhook',
      symbolType: 'FUNCTION',
      startLine: 35,
      endLine: 88,
      content: `export async function processPaymentWebhook(payload: any, signature: string): Promise<boolean> {\n  const isValid = verifyHmacSignature(payload, signature, process.env.PAYMENT_SECRET);\n  if (!isValid) throw new Error("Chữ ký HMAC thanh toán không hợp lệ!");\n  await OrderModel.findByIdAndUpdate(payload.orderId, { status: "PAID" });\n  logger.info("Payment confirmed for order: " + payload.orderId);\n  return true;\n}`,
      dependencies: ['src/models/order.model.ts', 'src/utils/logger.util.ts'],
      embedding: createMockEmbedding(1),
    },
    {
      repoId: cafeVibe._id,
      filePath: 'src/services/order.service.ts',
      symbolName: 'createOrder',
      symbolType: 'FUNCTION',
      startLine: 40,
      endLine: 95,
      content: `export async function createOrder(userId: string, items: OrderItem[]): Promise<Order> {\n  const total = items.reduce((acc, item) => acc + item.price * item.quantity, 0);\n  const order = await OrderModel.create({ userId, items, total, status: "PENDING" });\n  await paymentService.initiateCheckout(order._id, total);\n  return order;\n}`,
      dependencies: ['src/models/order.model.ts', 'src/services/payment.service.ts', 'src/models/menuItem.model.ts'],
      embedding: createMockEmbedding(2),
    },
    {
      repoId: cafeVibe._id,
      filePath: 'src/services/auth.service.ts',
      symbolName: 'loginUser',
      symbolType: 'FUNCTION',
      startLine: 25,
      endLine: 65,
      content: `export async function loginUser(email: string, pass: string): Promise<{ token: string; user: any }> {\n  const user = await UserModel.findOne({ email });\n  if (!user || !(await bcrypt.compare(pass, user.passwordHash))) {\n    throw new Error("Thông tin đăng nhập không chính xác");\n  }\n  const token = jwtUtil.signToken({ userId: user._id, role: user.role });\n  return { token, user };\n}`,
      dependencies: ['src/models/user.model.ts', 'src/utils/jwt.util.ts'],
      embedding: createMockEmbedding(3),
    },
    {
      repoId: cafeVibe._id,
      filePath: 'src/controllers/order.controller.ts',
      symbolName: 'handleCheckout',
      symbolType: 'FUNCTION',
      startLine: 50,
      endLine: 90,
      content: `export async function handleCheckout(req: Request, res: Response) {\n  const { items } = req.body;\n  const order = await orderService.createOrder(req.user.id, items);\n  res.status(201).json(order);\n}`,
      dependencies: ['src/services/order.service.ts', 'src/services/payment.service.ts'],
      embedding: createMockEmbedding(4),
    },
  ];

  await CodeChunkModel.insertMany(cafeVibeChunks);
  console.log(`✅ [Seeder] Đã nạp ${cafeVibeChunks.length} Code Chunks cho CafeVibe`);

  // Seed Bản ghi PR Review mẫu cho CafeVibe (PR #12)
  await PRReviewModel.deleteMany({ repoId: cafeVibe._id });
  await PRReviewModel.create({
    repoId: cafeVibe._id,
    prNumber: 12,
    title: 'Refactor Payment Gateway & Webhook Signature Verification',
    author: 'kdquach',
    riskScore: 68,
    status: 'COMMENTED',
    summary: 'PR tái cấu trúc cơ chế tiếp nhận webhook cổng thanh toán và cập nhật trạng thái đơn hàng. Có rủi ro tiềm ẩn phá vỡ tương thích (Breaking Change) đối với OrderService.',
    mermaidSummary: `sequenceDiagram\n  autonumber\n  actor Client as Mobile Client\n  participant Controller as order.controller.ts\n  participant Service as payment.service.ts\n  participant Gateway as Payment Gateway (Stripe/VNPay)\n  Client->>Controller: POST /api/orders/checkout\n  Controller->>Service: initiateCheckout(orderId)\n  Service->>Gateway: POST /v1/charges\n  Gateway-->>Service: Webhook Event (HMAC-SHA256)\n  Service-->>Controller: Order Status = PAID`,
    issues: [
      {
        filePath: 'src/services/payment.service.ts',
        lineNumber: 42,
        severity: 'CRITICAL',
        message: 'Thiếu cơ chế Idempotency Key khi gửi yêu cầu sang cổng thanh toán, dẫn đến nguy cơ trừ tiền lặp lại (Double Charge).',
        suggestedFix: 'const idempotencyKey = crypto.createHash("sha256").update(orderId).digest("hex");\nawait gateway.charges.create(payload, { headers: { "Idempotency-Key": idempotencyKey } });',
      },
      {
        filePath: 'src/services/payment.service.ts',
        lineNumber: 78,
        severity: 'HIGH',
        message: 'Chưa kiểm tra hết hạn thời gian của chữ ký webhook (Timestamp Drift), có thể bị tấn công lặp lại (Replay Attack).',
        suggestedFix: 'const tolerance = 300; // 5 phút\nif (Math.abs(Date.now() / 1000 - timestamp) > tolerance) throw new Error("Chữ ký webhook đã hết hạn");',
      },
      {
        filePath: 'src/controllers/order.controller.ts',
        lineNumber: 85,
        severity: 'MEDIUM',
        message: 'Cần xác thực tổng tiền giỏ hàng từ Database thay vì tin tưởng hoàn toàn dữ liệu gửi lên từ phía Client.',
        suggestedFix: 'const verifiedTotal = await calculateActualTotal(items);\nif (verifiedTotal !== payloadTotal) throw new Error("Giá trị giỏ hàng không khớp");',
      },
    ],
    impactedFiles: ['src/services/order.service.ts', 'src/controllers/order.controller.ts'],
    githubCommentUrl: 'https://github.com/kdquach/CafeVibe/pull/12#issuecomment-sample',
  });
  console.log('✅ [Seeder] Đã tạo PR Review mẫu cho CafeVibe (PR #12)');

  // ─────────────────────────────────────────────────────────────
  // 2. REPOSITORY MẪU: Zod (Validation Library)
  // ─────────────────────────────────────────────────────────────
  const zodUrl = 'https://github.com/colinhacks/zod';
  let zodRepo = await RepositoryModel.findOne({ repoUrl: zodUrl });

  const zodGraph = {
    nodes: [
      { id: 'src/index.ts', label: 'index.ts', category: 'util' as const, loc: 60 },
      { id: 'src/types.ts', label: 'types.ts', category: 'model' as const, loc: 540 },
      { id: 'src/parser.ts', label: 'parser.ts', category: 'service' as const, loc: 320 },
      { id: 'src/helpers/errorUtil.ts', label: 'errorUtil.ts', category: 'util' as const, loc: 110 },
      { id: 'src/helpers/parseUtil.ts', label: 'parseUtil.ts', category: 'util' as const, loc: 180 },
    ],
    edges: [
      { id: 'ze1', source: 'src/index.ts', target: 'src/types.ts' },
      { id: 'ze2', source: 'src/types.ts', target: 'src/parser.ts' },
      { id: 'ze3', source: 'src/parser.ts', target: 'src/helpers/errorUtil.ts' },
      { id: 'ze4', source: 'src/parser.ts', target: 'src/helpers/parseUtil.ts' },
    ],
  };

  if (!zodRepo) {
    zodRepo = await RepositoryModel.create({
      owner: 'colinhacks',
      name: 'zod',
      repoUrl: zodUrl,
      status: 'COMPLETED',
      isSample: true,
      description: 'TypeScript-first schema declaration and validation library with static type inference',
      summary: 'Thư viện xác thực Schema hướng TypeScript mạnh mẽ, tối ưu hoá AST type deduction tại thời điểm compile-time.',
      architectureGraph: zodGraph,
    });
    console.log('✅ [Seeder] Đã tạo Repository Zod');
  } else {
    zodRepo.architectureGraph = zodGraph;
    zodRepo.isSample = true;
    zodRepo.status = 'COMPLETED';
    await zodRepo.save();
    console.log('🔄 [Seeder] Đã cập nhật Repository Zod');
  }

  // Seed Code Chunks cho Zod (Cách ly chặt chẽ theo zodRepo._id)
  await CodeChunkModel.deleteMany({ repoId: zodRepo._id });
  const zodChunks = [
    {
      repoId: zodRepo._id,
      filePath: 'src/index.ts',
      symbolName: 'z',
      symbolType: 'COMPONENT',
      startLine: 1,
      endLine: 45,
      content: `import * as z from "./external";\nexport * from "./external";\nexport { z };\nexport default z;`,
      dependencies: ['src/types.ts', 'src/parser.ts'],
      embedding: createMockEmbedding(101),
    },
    {
      repoId: zodRepo._id,
      filePath: 'src/types.ts',
      symbolName: 'ZodType',
      symbolType: 'CLASS',
      startLine: 50,
      endLine: 120,
      content: `export abstract class ZodType<Output = any, Def extends ZodTypeDef = ZodTypeDef, Input = Output> {\n  readonly _type!: Output;\n  readonly _output!: Output;\n  readonly _input!: Input;\n  readonly _def!: Def;\n  abstract _parse(input: ParseInput): ParseReturnType<Output>;\n  parse(data: unknown, params?: Partial<ParseParams>): Output {\n    const result = this.safeParse(data, params);\n    if (result.success) return result.data;\n    throw result.error;\n  }\n}`,
      dependencies: ['src/parser.ts', 'src/helpers/errorUtil.ts'],
      embedding: createMockEmbedding(102),
    },
    {
      repoId: zodRepo._id,
      filePath: 'src/parser.ts',
      symbolName: 'safeParse',
      symbolType: 'FUNCTION',
      startLine: 30,
      endLine: 75,
      content: `export function safeParse<T>(schema: ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: ZodError } {\n  const ctx = { common: { issues: [] } };\n  const result = schema._parse({ data, path: [], parent: ctx });\n  if (ctx.common.issues.length === 0) return { success: true, data: result.value };\n  return { success: false, error: new ZodError(ctx.common.issues) };\n}`,
      dependencies: ['src/helpers/errorUtil.ts', 'src/helpers/parseUtil.ts'],
      embedding: createMockEmbedding(103),
    },
  ];
  await CodeChunkModel.insertMany(zodChunks);
  console.log(`✅ [Seeder] Đã nạp ${zodChunks.length} Code Chunks cho Zod`);

  // ─────────────────────────────────────────────────────────────
  // 3. REPOSITORY MẪU: Express.js
  // ─────────────────────────────────────────────────────────────
  const expressUrl = 'https://github.com/expressjs/express';
  let expressRepo = await RepositoryModel.findOne({ repoUrl: expressUrl });

  const expressGraph = {
    nodes: [
      { id: 'lib/express.js', label: 'express.js', category: 'controller' as const, loc: 110 },
      { id: 'lib/application.js', label: 'application.js', category: 'service' as const, loc: 640 },
      { id: 'lib/router/index.js', label: 'router.js', category: 'service' as const, loc: 480 },
      { id: 'lib/middleware/init.js', label: 'init.js', category: 'util' as const, loc: 50 },
      { id: 'lib/response.js', label: 'response.js', category: 'util' as const, loc: 390 },
      { id: 'lib/request.js', label: 'request.js', category: 'util' as const, loc: 310 },
    ],
    edges: [
      { id: 'ee1', source: 'lib/express.js', target: 'lib/application.js' },
      { id: 'ee2', source: 'lib/application.js', target: 'lib/router/index.js' },
      { id: 'ee3', source: 'lib/application.js', target: 'lib/middleware/init.js' },
      { id: 'ee4', source: 'lib/router/index.js', target: 'lib/response.js' },
      { id: 'ee5', source: 'lib/router/index.js', target: 'lib/request.js' },
    ],
  };

  if (!expressRepo) {
    expressRepo = await RepositoryModel.create({
      owner: 'expressjs',
      name: 'express',
      repoUrl: expressUrl,
      status: 'COMPLETED',
      isSample: true,
      description: 'Fast, unopinionated, minimalist web framework for Node.js',
      summary: 'Khung ứng dụng web chuẩn mực của hệ sinh thái Node.js với mô hình Middleware pipeline và Router lồng nhau.',
      architectureGraph: expressGraph,
    });
    console.log('✅ [Seeder] Đã tạo Repository Express.js');
  } else {
    expressRepo.architectureGraph = expressGraph;
    expressRepo.isSample = true;
    expressRepo.status = 'COMPLETED';
    await expressRepo.save();
    console.log('🔄 [Seeder] Đã cập nhật Repository Express.js');
  }

  // Seed Code Chunks cho Express (Cách ly chặt chẽ theo expressRepo._id)
  await CodeChunkModel.deleteMany({ repoId: expressRepo._id });
  const expressChunks = [
    {
      repoId: expressRepo._id,
      filePath: 'lib/express.js',
      symbolName: 'createApplication',
      symbolType: 'FUNCTION',
      startLine: 25,
      endLine: 60,
      content: `function createApplication() {\n  var app = function(req, res, next) {\n    app.handle(req, res, next);\n  };\n  mixin(app, EventEmitter.prototype, false);\n  mixin(app, proto, false);\n  app.request = Object.create(req, { app: { configurable: true, enumerable: true, writable: true, value: app } });\n  app.response = Object.create(res, { app: { configurable: true, enumerable: true, writable: true, value: app } });\n  app.init();\n  return app;\n}`,
      dependencies: ['lib/application.js', 'lib/request.js', 'lib/response.js'],
      embedding: createMockEmbedding(201),
    },
    {
      repoId: expressRepo._id,
      filePath: 'lib/application.js',
      symbolName: 'app.use',
      symbolType: 'FUNCTION',
      startLine: 180,
      endLine: 235,
      content: `app.use = function use(fn) {\n  var offset = 0;\n  var path = '/';\n  if (typeof fn !== 'function') {\n    var arg = fn;\n    while (Array.isArray(arg) && arg.length !== 0) { arg = arg[0]; }\n    if (typeof arg !== 'function') { offset = 1; path = fn; }\n  }\n  var fns = flatten(slice.call(arguments, offset));\n  this.lazyrouter();\n  var router = this._router;\n  fns.forEach(function (fn) {\n    router.use(path, fn);\n  });\n  return this;\n};`,
      dependencies: ['lib/router/index.js', 'lib/middleware/init.js'],
      embedding: createMockEmbedding(202),
    },
    {
      repoId: expressRepo._id,
      filePath: 'lib/router/index.js',
      symbolName: 'handle',
      symbolType: 'FUNCTION',
      startLine: 120,
      endLine: 185,
      content: `proto.handle = function handle(req, res, out) {\n  var self = this;\n  var idx = 0;\n  var protohost = getProtohost(req.url) || '';\n  var removed = '';\n  var slashAdded = false;\n  var paramcalled = {};\n  // Middleware next() invocation loop\n  next();\n  function next(err) { /* Execute layers matching req.url */ }\n};`,
      dependencies: ['lib/response.js', 'lib/request.js'],
      embedding: createMockEmbedding(203),
    },
  ];
  await CodeChunkModel.insertMany(expressChunks);
  console.log(`✅ [Seeder] Đã nạp ${expressChunks.length} Code Chunks cho Express.js`);

  console.log('🎉 [Seeder] Hoàn thành nạp dữ liệu Sample Repositories!');
}

// Chạy trực tiếp khi gọi qua CLI: npm run seed
if (require.main === module) {
  seedSampleRepositories()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ [Seeder] Lỗi khi nạp dữ liệu:', err);
      process.exit(1);
    });
}

