import type { FastifyInstance } from 'fastify';
import { ok } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { reviewService } from '../services/review.service';
import { getDb } from '../utils/db';

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/review/today', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const recordIds = await reviewService.getTodayReviews(userId);

    if (recordIds.length === 0) return ok(reply, { records: [], count: 0 });

    const records = await getDb().errorRecord.findMany({
      where: { id: { in: recordIds } },
    });

    const mapped = records.map((r) => ({
      id: r.id,
      subject: r.subject,
      knowledgePoint: r.knowledgePoint,
      errorSummary: r.errorSummary,
      status: r.status,
      createdAt: r.createdAt,
    }));

    return ok(reply, { records: mapped, count: mapped.length });
  });
}
