// apps/server/src/controllers/prReview.controller.ts
import { Request, Response } from 'express';
import { PRReviewModel } from '../models/prReview.model';

export class PRReviewController {
  /**
   * GET /api/repos/:id/reviews
   * Lấy lịch sử các đợt PR Review của một Repository
   */
  static async getRepoReviews(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const reviews = await PRReviewModel.find({ repoId: id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      res.json(reviews);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Lỗi lấy danh sách PR reviews' });
    }
  }

  /**
   * GET /api/reviews/:reviewId
   * Lấy chi tiết một bản ghi review cụ thể
   */
  static async getReviewById(req: Request, res: Response): Promise<void> {
    try {
      const { reviewId } = req.params;
      const review = await PRReviewModel.findById(reviewId).lean();

      if (!review) {
        res.status(404).json({ message: 'Không tìm thấy bản ghi PR Review.' });
        return;
      }

      res.json(review);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Lỗi lấy chi tiết review' });
    }
  }
}

