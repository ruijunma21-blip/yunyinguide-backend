import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { addMonths, addYears } from 'date-fns';

const PLANS = {
  monthly: { price: 2900, label: '月卡', getDuration: (from: Date) => addMonths(from, 1) },
  yearly: { price: 19900, label: '年卡', getDuration: (from: Date) => addYears(from, 1) },
};

export async function paymentRoutes(app: FastifyInstance) {
  app.get('/payment/subscription', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const sub = await getDb().subscription.findUnique({ where: { userId } });
    return ok(reply, {
      planType: sub?.planType ?? 'free',
      endAt: sub?.endAt,
      isActive: !!(sub && sub.planType !== 'free' && sub.endAt && sub.endAt > new Date()),
    });
  });

  app.post('/payment/create-order', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { planType, paymentMethod } = req.body as { planType: string; paymentMethod: string };

    if (!PLANS[planType as keyof typeof PLANS]) return fail(reply, '无效的套餐类型');
    if (!['wechat', 'alipay'].includes(paymentMethod)) return fail(reply, '无效的支付方式');

    const plan = PLANS[planType as keyof typeof PLANS];
    const order = await getDb().order.create({
      data: {
        userId,
        amount: plan.price,
        planType,
        paymentMethod,
        status: 'pending',
      },
    });

    // TODO: integrate WeChat Pay / Alipay SDK to get actual payment params
    return ok(reply, {
      orderId: order.id,
      amount: plan.price,
      planLabel: plan.label,
      paymentMethod,
      status: 'pending',
      // paymentParams: {} // Will be populated once payment SDK is integrated
    }, 201);
  });

  app.post('/payment/notify/:method', async (req, reply) => {
    // Payment provider webhook callback
    const { method } = req.params as { method: string };
    const body = req.body as Record<string, string>;

    // TODO: verify signature from payment provider
    const orderId = body.out_trade_no ?? body.orderId;
    const tradeStatus = body.trade_status ?? body.resultCode;

    if (!orderId) return reply.status(400).send({ code: 'FAIL' });

    const order = await getDb().order.findUnique({ where: { id: orderId } });
    if (!order) return reply.status(400).send({ code: 'FAIL' });

    const isSuccess = method === 'wechat'
      ? body.return_code === 'SUCCESS' && body.result_code === 'SUCCESS'
      : tradeStatus === 'TRADE_SUCCESS';

    if (isSuccess && order.status !== 'paid') {
      await getDb().order.update({ where: { id: orderId }, data: { status: 'paid', paymentId: body.transaction_id ?? body.trade_no } });

      const plan = PLANS[order.planType as keyof typeof PLANS];
      const now = new Date();
      const sub = await getDb().subscription.findUnique({ where: { userId: order.userId } });
      const startFrom = sub?.endAt && sub.endAt > now ? sub.endAt : now;
      const endAt = plan.getDuration(startFrom);

      await getDb().subscription.upsert({
        where: { userId: order.userId },
        create: { userId: order.userId, planType: order.planType, startAt: now, endAt, status: 'active' },
        update: { planType: order.planType, endAt, status: 'active' },
      });
    }

    return reply.send(method === 'wechat' ? '<xml><return_code><![CDATA[SUCCESS]]></return_code></xml>' : 'success');
  });

  // Invite code / referral system
  app.post('/payment/use-invite', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { inviteCode } = req.body as { inviteCode: string };
    // Simplified: inviteCode = 7-day free trial gift
    // TODO: track who invited whom and prevent abuse
    const sub = await getDb().subscription.findUnique({ where: { userId } });
    if (sub && sub.planType !== 'free') return fail(reply, '已是会员，无需使用邀请码');

    const endAt = addMonths(new Date(), 0);
    endAt.setDate(endAt.getDate() + 7);
    await getDb().subscription.upsert({
      where: { userId },
      create: { userId, planType: 'trial', startAt: new Date(), endAt, status: 'active' },
      update: { planType: 'trial', endAt, status: 'active' },
    });
    return ok(reply, { message: '7天体验会员已开通！', endAt });
  });
}
