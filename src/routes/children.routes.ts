import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';



export async function childrenRoutes(app: FastifyInstance) {
  app.get('/children', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const children = await getDb().child.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return ok(reply, children);
  });

  app.post('/children', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { nickname, grade } = req.body as { nickname: string; grade: number };
    if (!nickname || !grade) return fail(reply, '参数不完整');
    const child = await getDb().child.create({ data: { userId, nickname, grade } });
    return ok(reply, child, 201);
  });

  app.patch('/children/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };
    const { nickname, grade } = req.body as { nickname?: string; grade?: number };
    const child = await getDb().child.findFirst({ where: { id, userId } });
    if (!child) return fail(reply, '孩子档案不存在', 404);
    const updated = await getDb().child.update({ where: { id }, data: { nickname, grade } });
    return ok(reply, updated);
  });

  app.delete('/children/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };
    const child = await getDb().child.findFirst({ where: { id, userId } });
    if (!child) return fail(reply, '孩子档案不存在', 404);
    await getDb().child.delete({ where: { id } });
    return ok(reply, { message: '已删除' });
  });
}
