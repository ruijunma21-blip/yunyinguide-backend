import { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { requireAuth } from '../middleware/auth.middleware';
import { ok, fail } from '../utils/response';
import { aiService } from '../services/ai.service';

export async function gradesRoutes(app: FastifyInstance) {
  // 录入成绩
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { childId, subject, score, fullScore, examName, examDate, semester } = req.body as any;
    if (!childId || !subject || score === undefined) return fail(reply, '参数不完整', 400);
    const db = getDb();
    const grade = await db.examGrade.create({
      data: {
        userId, childId, subject,
        score: Number(score),
        fullScore: Number(fullScore ?? 100),
        examName: examName ?? '',
        examDate: examDate ? new Date(examDate) : new Date(),
        semester: semester ?? '',
      },
    });
    return ok(reply, grade, 201);
  });

  // 获取成绩列表
  app.get('/', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { childId, subject, limit = '20' } = req.query as any;
    const db = getDb();
    const where: any = { userId };
    if (childId) where.childId = childId;
    if (subject) where.subject = subject;
    const grades = await db.examGrade.findMany({
      where,
      orderBy: { examDate: 'desc' },
      take: Number(limit),
    });
    return ok(reply, grades);
  });

  // AI 成绩分析报告
  app.get('/analysis/:childId', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { childId } = req.params as any;
    const db = getDb();
    const grades = await db.examGrade.findMany({
      where: { userId, childId },
      orderBy: { examDate: 'desc' },
      take: 30,
    });
    if (grades.length === 0) return fail(reply, '暂无成绩数据', 404);
    const analysis = await aiService.analyzeGrades(grades.map(g => ({ ...g, examDate: g.examDate.toISOString() })));
    return ok(reply, analysis);
  });

  // 删除成绩
  app.delete('/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { id } = req.params as any;
    const db = getDb();
    await db.examGrade.deleteMany({ where: { id, userId } });
    return ok(reply, { deleted: true });
  });
}
