import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';

// 验证管理员 JWT（复用 admin.routes 同样的逻辑）
async function requireAdmin(req: any, reply: any) {
  try {
    await req.jwtVerify();
    if (!(req.user as any).isAdmin) return fail(reply, '无权限', 403);
  } catch {
    return fail(reply, '未登录', 401);
  }
}

export async function announcementRoutes(app: FastifyInstance) {
  // ── 公开：获取活跃公告列表（App 启动时调用）──────────────
  app.get('/announcements', async (_req, reply) => {
    const items = await getDb().announcement.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
      take: 5,
    });
    return ok(reply, items);
  });

  // ── 管理员：创建公告 ──────────────────────────────────────
  app.post('/admin/announcements', { preHandler: requireAdmin }, async (req, reply) => {
    const { title, content, type = 'info', sortOrder = 0 } = req.body as any;
    if (!title?.trim() || !content?.trim()) return fail(reply, '标题和内容不能为空');
    if (!['info', 'warning', 'urgent'].includes(type)) return fail(reply, '类型无效');

    const item = await getDb().announcement.create({
      data: { title: title.trim(), content: content.trim(), type, sortOrder: Number(sortOrder) },
    });
    return ok(reply, item);
  });

  // ── 管理员：更新公告 ──────────────────────────────────────
  app.patch('/admin/announcements/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const { title, content, type, isActive, sortOrder } = req.body as any;

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = String(title).trim();
    if (content !== undefined) data.content = String(content).trim();
    if (type !== undefined && ['info', 'warning', 'urgent'].includes(type)) data.type = type;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);

    const item = await getDb().announcement.update({ where: { id }, data });
    return ok(reply, item);
  });

  // ── 管理员：删除公告 ──────────────────────────────────────
  app.delete('/admin/announcements/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    await getDb().announcement.delete({ where: { id } });
    return ok(reply, { message: '已删除' });
  });

  // ── 管理员：公告列表（含未激活）──────────────────────────
  app.get('/admin/announcements', { preHandler: requireAdmin }, async (_req, reply) => {
    const items = await getDb().announcement.findMany({
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
    });
    return ok(reply, items);
  });
}
