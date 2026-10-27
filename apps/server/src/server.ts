import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/database';
import apiRoutes from './routes';
import { startIngestWorker } from './workers/ingest.worker';
import { startPRReviewWorker } from './workers/prReview.worker';
import { seedSampleRepositories } from './scripts/seed-samples';
import { RepositoryModel } from './models/repository.model';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());

// Giữ lại rawBody Buffer phục vụ xác thực chữ ký HMAC-SHA256 từ GitHub Webhook
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use('/api', apiRoutes);

app.get('/health', (_, res) => res.json({ status: 'OK', service: 'CodeLens Express API' }));

connectDB().then(async () => {
  // Tự động khởi chạy BullMQ Ingest Worker & PR Review Worker cùng tiến trình API
  startIngestWorker();
  startPRReviewWorker();

  // Khởi tạo Sample Repositories nếu cơ sở dữ liệu chưa có (Task TS-18)
  try {
    const sampleCount = await RepositoryModel.countDocuments({ isSample: true });
    if (sampleCount === 0) {
      console.log('💡 [Express Server] Chưa có Sample Repositories. Đang tự động nạp dữ liệu mẫu...');
      await seedSampleRepositories();
    }
  } catch (err: any) {
    console.warn(`⚠️ [Express Server] Bỏ qua kiểm tra dữ liệu mẫu: ${err.message}`);
  }

  app.listen(PORT, () => {
    console.log(`🚀 [Express Server] Running on http://localhost:${PORT}`);
  });
});
