import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import * as bcrypt from 'bcryptjs';
import { ok, fail } from '../utils/response';
import { env } from '../utils/env';
import { addPoints } from './invite.routes';

// 验证管理员 JWT
async function requireAdmin(req: any, reply: any) {
  try {
    await req.jwtVerify();
    if (!(req.user as any).isAdmin) return fail(reply, '无权限', 403);
  } catch {
    return fail(reply, '未登录', 401);
  }
}

// 管理员登录：每个 IP 每 15 分钟最多 5 次，比普通用户更严格
const adminLoginRateLimit = {
  config: {
    rateLimit: { max: 5, timeWindow: '15 minutes' },
  },
};

export async function adminRoutes(app: FastifyInstance) {
  // ── 管理员登录 ────────────────────────────────────────
  app.post('/admin/login', adminLoginRateLimit, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    if (email !== env.adminEmail) return fail(reply, '账号或密码错误');
    const ok_ = await bcrypt.compare(password, env.adminPasswordHash);
    if (!ok_) return fail(reply, '账号或密码错误');
    const token = app.jwt.sign({ isAdmin: true, email }, { expiresIn: '7d' });
    return ok(reply, { token });
  });

  // ── 数据统计 ──────────────────────────────────────────
  app.get('/admin/stats', { preHandler: requireAdmin }, async (_req, reply) => {
    const db = getDb();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [totalUsers, todayUsers, premiumUsers, totalPosts, totalOrders,
      pendingOrders, totalErrorRecords, todayUsage] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: today } } }),
      db.subscription.count({ where: { status: 'active', planType: { not: 'free' }, endAt: { gt: new Date() } } }),
      db.post.count({ where: { status: 'published' } }),
      db.order.count(),
      db.order.count({ where: { status: 'pending' } }),
      db.errorRecord.count(),
      db.dailyUsage.aggregate({ _sum: { usageCount: true }, where: { date: today.toISOString().slice(0, 10) } }),
    ]);

    return ok(reply, {
      totalUsers, todayUsers, premiumUsers,
      totalPosts, totalOrders, pendingOrders,
      totalErrorRecords,
      todayAiCalls: todayUsage._sum.usageCount ?? 0,
    });
  });

  // ── 用户列表 ──────────────────────────────────────────
  app.get('/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = '1', search = '' } = req.query as any;
    const take = 20;
    const skip = (parseInt(page) - 1) * take;
    const db = getDb();

    const where = search ? {
      OR: [
        { phone: { contains: search } },
        { nickname: { contains: search } },
      ],
    } : {};

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { subscription: true },
      }),
      db.user.count({ where }),
    ]);

    return ok(reply, {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / take),
      items: users.map(u => ({
        id: u.id,
        phone: u.phone,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        createdAt: u.createdAt,
        status: u.status,
        isPremium: !!(u.subscription && u.subscription.planType !== 'free' && u.subscription.endAt && u.subscription.endAt > new Date()),
        premiumEndAt: u.subscription?.endAt,
        planType: u.subscription?.planType ?? 'free',
      })),
    });
  });

  // ── 开通会员 ──────────────────────────────────────────
  app.post('/admin/users/:id/grant-premium', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const { months = 1, plan = 'monthly' } = req.body as any;
    const db = getDb();

    const user = await db.user.findUnique({ where: { id }, include: { subscription: true } });
    if (!user) return fail(reply, '用户不存在', 404);

    const now = new Date();
    const currentEnd = user.subscription?.endAt && user.subscription.endAt > now
      ? user.subscription.endAt
      : now;
    const endAt = new Date(currentEnd.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    await db.subscription.upsert({
      where: { userId: id },
      create: { userId: id, planType: plan, startAt: now, endAt, status: 'active' },
      update: { planType: plan, endAt, status: 'active' },
    });

    return ok(reply, { message: `已开通${months}个月会员，到期时间：${endAt.toLocaleDateString('zh-CN')}` });
  });

  // ── 禁用/恢复用户 ─────────────────────────────────────
  app.patch('/admin/users/:id/status', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const { status } = req.body as any;
    await getDb().user.update({ where: { id }, data: { status } });
    return ok(reply, { message: '已更新' });
  });

  // ── 帖子列表 ──────────────────────────────────────────
  app.get('/admin/posts', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = '1', status = '' } = req.query as any;
    const take = 20;
    const skip = (parseInt(page) - 1) * take;
    const db = getDb();
    const where = status ? { status } : {};

    const [posts, total] = await Promise.all([
      db.post.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, nickname: true, phone: true } } },
      }),
      db.post.count({ where }),
    ]);

    return ok(reply, {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / take),
      items: posts.map(p => ({
        id: p.id,
        content: p.content.slice(0, 100),
        status: p.status,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        createdAt: p.createdAt,
        author: p.user,
      })),
    });
  });

  // ── 修改帖子状态 ──────────────────────────────────────
  app.patch('/admin/posts/:id/status', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const { status } = req.body as any;
    await getDb().post.update({ where: { id }, data: { status } });
    return ok(reply, { message: '已更新' });
  });

  // ── 订单列表 ──────────────────────────────────────────
  app.get('/admin/orders', { preHandler: requireAdmin }, async (req, reply) => {
    const { page = '1', status = '' } = req.query as any;
    const take = 20;
    const skip = (parseInt(page) - 1) * take;
    const db = getDb();
    const where = status ? { status } : {};

    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, nickname: true, phone: true } } },
      }),
      db.order.count({ where }),
    ]);

    return ok(reply, {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / take),
      items: orders.map(o => ({
        id: o.id,
        userId: o.userId,
        amount: o.amount,
        planType: o.planType,
        paymentMethod: o.paymentMethod,
        status: o.status,
        createdAt: o.createdAt,
        user: o.user,
      })),
    });
  });

  // ── 查看用户积分 ──────────────────────────────────────
  app.get('/admin/users/:id/points', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const db = getDb();
    const [points, txs, referrals] = await Promise.all([
      db.userPoints.findUnique({ where: { userId: id } }),
      db.pointTransaction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      db.referral.count({ where: { inviterId: id } }),
    ]);
    return ok(reply, { balance: points?.balance ?? 0, totalInvited: referrals, transactions: txs });
  });

  // ── 手动调整积分 ──────────────────────────────────────
  app.post('/admin/users/:id/points', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const { amount, note = '管理员手动调整' } = req.body as any;
    if (!amount || isNaN(Number(amount))) return fail(reply, '金额无效');
    const db = getDb();
    await addPoints(id, Number(amount), 'manual_add', note, db);
    const p = await db.userPoints.findUnique({ where: { userId: id } });
    return ok(reply, { message: '积分已调整', newBalance: p?.balance ?? 0 });
  });

  // ── 完成订单（手动确认付款，开通会员）────────────────
  app.post('/admin/orders/:id/complete', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as any;
    const db = getDb();

    const order = await db.order.findUnique({ where: { id } });
    if (!order) return fail(reply, '订单不存在', 404);
    if (order.status === 'completed') return fail(reply, '订单已完成');

    await db.order.update({ where: { id }, data: { status: 'completed' } });

    const months = order.planType === 'yearly' ? 12 : 1;
    const now = new Date();
    const sub = await db.subscription.findUnique({ where: { userId: order.userId } });
    const currentEnd = sub?.endAt && sub.endAt > now ? sub.endAt : now;
    const endAt = new Date(currentEnd.getTime() + months * 30 * 24 * 60 * 60 * 1000);

    await db.subscription.upsert({
      where: { userId: order.userId },
      create: { userId: order.userId, planType: order.planType, startAt: now, endAt, status: 'active' },
      update: { planType: order.planType, endAt, status: 'active' },
    });

    // 查找邀请关系，给邀请人奖励积分
    try {
      const referral = await db.referral.findUnique({
        where: { inviteeId: order.userId },
        include: { invitee: { select: { nickname: true, phone: true } } },
      });
      if (referral && referral.status === 'registered') {
        const inviteeName = referral.invitee.nickname || referral.invitee.phone.slice(-4);
        await Promise.all([
          addPoints(referral.inviterId, 50, 'invite_paid', `${inviteeName} 开通了会员`, db),
          db.referral.update({ where: { inviteeId: order.userId }, data: { status: 'rewarded' } }),
        ]);
      }
    } catch { /* 积分奖励失败不影响主流程 */ }

    return ok(reply, { message: `已确认付款，会员已开通至 ${endAt.toLocaleDateString('zh-CN')}` });
  });
}
