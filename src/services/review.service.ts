import { getDb } from '../utils/db';
import { format, addDays } from 'date-fns';

// Ebbinghaus review intervals (days after creation)
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];

export const reviewService = {
  async getTodayReviews(userId: string): Promise<string[]> {
    const today = format(new Date(), 'yyyy-MM-dd');
    const records = await getDb().errorRecord.findMany({
      where: { userId, status: 'reviewing' },
      select: { id: true, createdAt: true },
    });

    const due: string[] = [];
    for (const r of records) {
      const daysSince = Math.floor((Date.now() - r.createdAt.getTime()) / 86400000);
      if (REVIEW_INTERVALS.includes(daysSince)) {
        due.push(r.id);
      }
    }
    return due;
  },

  getNextReviewDate(createdAt: Date, currentInterval: number): Date {
    const nextInterval = REVIEW_INTERVALS.find((d) => d > currentInterval) ?? 30;
    return addDays(createdAt, nextInterval);
  },
};
