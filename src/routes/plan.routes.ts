import { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { requireAuth } from '../middleware/auth.middleware';
import { ok, fail } from '../utils/response';

export async function planRoutes(app: FastifyInstance) {
  // 创建学习计划
  app.post('/', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { childId, title, vocabGoal, reviewGoal, activeTo } = req.body as any;
    if (!childId || !title) return fail(reply, '参数不完整', 400);
    const db = getDb();
    const plan = await db.studyPlan.create({
      data: {
        userId, childId, title,
        vocabGoal: Number(vocabGoal ?? 0),
        reviewGoal: Number(reviewGoal ?? 0),
        activeTo: activeTo ? new Date(activeTo) : null,
      },
    });
    return ok(reply, plan, 201);
  });

  // 获取计划列表
  app.get('/', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { childId } = req.query as any;
    const db = getDb();
    const where: any = { userId };
    if (childId) where.childId = childId;
    const plans = await db.studyPlan.findMany({
      where,
      include: { records: { orderBy: { date: 'desc' }, take: 7 } },
      orderBy: { createdAt: 'desc' },
    });
    return ok(reply, plans);
  });

  // 打卡：提交今日完成情况
  app.post('/:planId/checkin', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { planId } = req.params as any;
    const { vocabDone, reviewDone } = req.body as any;
    const db = getDb();
    const plan = await db.studyPlan.findFirst({ where: { id: planId, userId } });
    if (!plan) return fail(reply, '计划不存在', 404);

    const today = new Date().toISOString().slice(0, 10);
    const completed =
      Number(vocabDone ?? 0) >= plan.vocabGoal &&
      Number(reviewDone ?? 0) >= plan.reviewGoal;

    const record = await db.studyRecord.upsert({
      where: { planId_date: { planId, date: today } },
      create: { planId, date: today, vocabDone: Number(vocabDone ?? 0), reviewDone: Number(reviewDone ?? 0), completed },
      update: { vocabDone: Number(vocabDone ?? 0), reviewDone: Number(reviewDone ?? 0), completed },
    });
    return ok(reply, record);
  });

  // 获取某计划打卡记录（近 30 天）
  app.get('/:planId/records', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { planId } = req.params as any;
    const db = getDb();
    const plan = await db.studyPlan.findFirst({ where: { id: planId, userId } });
    if (!plan) return fail(reply, '计划不存在', 404);
    const records = await db.studyRecord.findMany({
      where: { planId },
      orderBy: { date: 'desc' },
      take: 30,
    });
    return ok(reply, records);
  });
}
