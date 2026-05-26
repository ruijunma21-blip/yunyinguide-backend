import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';

// 积分规则（集中管理，方便日后调整）
const POINTS = {
  inviteRegister: 10,   // 被邀请人注册奖励
  invitePaid:     50,   // 被邀请人开通会员奖励
  redeemCost:     100,  // 兑换1个月会员所需积分
};

/** 生成6位大写字母+数字邀请码 */
function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** 确保用户有积分账户，返回余额 */
async function ensurePoints(userId: string, db = getDb()) {
  const p = await db.userPoints.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
  return p.balance;
}

/** 给用户加/减积分（事务安全） */
export async function addPoints(
  userId: string,
  amount: number,
  type: string,
  note: string,
  db = getDb(),
) {
  await db.$transaction([
    db.userPoints.upsert({
      where: { userId },
      create: { userId, balance: Math.max(0, amount) },
      update: { balance: { increment: amount } },
    }),
    db.pointTransaction.create({ data: { userId, amount, type, note } }),
  ]);
}

export async function inviteRoutes(app: FastifyInstance) {
  // ── 获取我的邀请码（不存在则自动创建）────────────────────
  app.get('/invite/code', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const db = getDb();

    let record = await db.inviteCode.findUnique({ where: { userId } });
    if (!record) {
      // 生成唯一码
      let code = genCode();
      let tries = 0;
      while (await db.inviteCode.findUnique({ where: { code } }) && tries < 10) {
        code = genCode();
        tries++;
      }
      record = await db.inviteCode.create({ data: { userId, code } });
    }

    const balance = await ensurePoints(userId, db);

    return ok(reply, {
      code: record.code,
      usedCount: record.usedCount,
      pointsBalance: balance,
      rules: {
        inviteRegister: POINTS.inviteRegister,
        invitePaid: POINTS.invitePaid,
        redeemCost: POINTS.redeemCost,
        redeemReward: '1个月会员',
      },
    });
  });

  // ── 邀请统计（邀请人列表 + 积分流水）────────────────────
  app.get('/invite/stats', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const db = getDb();

    const [referrals, transactions, points] = await Promise.all([
      db.referral.findMany({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { invitee: { select: { nickname: true, phone: true, createdAt: true } } },
      }),
      db.pointTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.userPoints.findUnique({ where: { userId } }),
    ]);

    return ok(reply, {
      pointsBalance: points?.balance ?? 0,
      totalInvited: referrals.length,
      referrals: referrals.map(r => ({
        inviteeNickname: r.invitee.nickname || '新用户',
        inviteePhone: r.invitee.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
        status: r.status,
        joinedAt: r.invitee.createdAt,
      })),
      transactions: transactions.map(t => ({
        amount: t.amount,
        type: t.type,
        note: t.note,
        createdAt: t.createdAt,
      })),
    });
  });

  // ── 积分兑换会员（100积分=1个月）────────────────────────
  app.post('/invite/redeem', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const db = getDb();

    const points = await db.userPoints.findUnique({ where: { userId } });
    const balance = points?.balance ?? 0;

    if (balance < POINTS.redeemCost) {
      return fail(reply, `积分不足，需要 ${POINTS.redeemCost} 积分，当前 ${balance} 积分`);
    }

    // 扣积分 + 开通1个月会员（事务）
    const now = new Date();
    const sub = await db.subscription.findUnique({ where: { userId } });
    const currentEnd = sub?.endAt && sub.endAt > now ? sub.endAt : now;
    const endAt = new Date(currentEnd.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.$transaction([
      db.userPoints.update({
        where: { userId },
        data: { balance: { decrement: POINTS.redeemCost } },
      }),
      db.pointTransaction.create({
        data: { userId, amount: -POINTS.redeemCost, type: 'redeem', note: '兑换1个月会员' },
      }),
      db.subscription.upsert({
        where: { userId },
        create: { userId, planType: 'monthly', startAt: now, endAt, status: 'active' },
        update: { planType: 'monthly', endAt, status: 'active' },
      }),
    ]);

    return ok(reply, {
      message: `兑换成功！会员已延长至 ${endAt.toLocaleDateString('zh-CN')}`,
      newBalance: balance - POINTS.redeemCost,
      premiumEndAt: endAt,
    });
  });
}
