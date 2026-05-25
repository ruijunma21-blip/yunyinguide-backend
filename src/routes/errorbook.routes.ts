import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';



export async function errorbookRoutes(app: FastifyInstance) {
  app.get('/errorbook', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { page = '1', pageSize = '20', subject, status } = req.query as Record<string, string>;
    const pageNum = parseInt(page, 10);
    const size = parseInt(pageSize, 10);

    const where: Record<string, unknown> = { userId };
    if (subject) where.subject = subject;
    if (status) where.status = status;

    const whereClause = where as { userId: string; subject?: string; status?: string };
    const [items, total] = await Promise.all([
      getDb().errorRecord.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size, take: size,
      }),
      getDb().errorRecord.count({ where: whereClause }),
    ]);

    const mapped = items.map((r: typeof items[0]) => ({
      id: r.id, userId: r.userId, childId: r.childId,
      subject: r.subject, grade: r.grade,
      questionText: r.questionText, studentAnswer: r.studentAnswer,
      correctAnswer: r.correctAnswer, imageUrl: r.imageUrl,
      analysisResult: {
        errorType: r.errorType, subject: r.subject,
        gradeLevel: r.gradeLevel, knowledgePoint: r.knowledgePoint,
        textbookChapter: r.textbookChapter, errorSummary: r.errorSummary,
        detailAnalysis: r.detailAnalysis, confidence: r.confidence,
        similarMistakes: r.similarMistakes,
      },
      guideScript: r.guideScript,
      status: r.status, createdAt: r.createdAt,
    }));

    return ok(reply, { items: mapped, total, page: pageNum, pageSize: size, hasMore: pageNum * size < total });
  });

  app.get('/errorbook/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };
    const r = await getDb().errorRecord.findFirst({ where: { id, userId } });
    if (!r) return fail(reply, '记录不存在', 404);
    return ok(reply, {
      id: r.id, userId: r.userId, childId: r.childId,
      subject: r.subject, grade: r.grade,
      questionText: r.questionText, studentAnswer: r.studentAnswer, correctAnswer: r.correctAnswer,
      imageUrl: r.imageUrl,
      analysisResult: {
        errorType: r.errorType, subject: r.subject, gradeLevel: r.gradeLevel,
        knowledgePoint: r.knowledgePoint, textbookChapter: r.textbookChapter,
        errorSummary: r.errorSummary, detailAnalysis: r.detailAnalysis,
        confidence: r.confidence, similarMistakes: r.similarMistakes,
      },
      guideScript: r.guideScript, status: r.status, createdAt: r.createdAt,
    });
  });

  app.patch('/errorbook/:id/status', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };
    const { status } = req.body as { status: string };
    if (!['mastered', 'reviewing', 'uncertain'].includes(status)) return fail(reply, '状态值不合法');
    const r = await getDb().errorRecord.findFirst({ where: { id, userId } });
    if (!r) return fail(reply, '记录不存在', 404);
    const updated = await getDb().errorRecord.update({ where: { id }, data: { status } });
    return ok(reply, { id: updated.id, status: updated.status });
  });

  app.delete('/errorbook/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };
    const r = await getDb().errorRecord.findFirst({ where: { id, userId } });
    if (!r) return fail(reply, '记录不存在', 404);
    await getDb().errorRecord.delete({ where: { id } });
    return ok(reply, { deleted: true });
  });
}
