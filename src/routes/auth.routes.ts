import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import * as bcrypt from 'bcryptjs';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { env } from '../utils/env';



function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/send-code', async (req, reply) => {
    const { phone } = req.body as { phone: string };
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return fail(reply, '手机号格式不正确');

    let user = await getDb().user.findUnique({ where: { phone } });
    if (!user) user = await getDb().user.create({ data: { phone, nickname: '家长' } });

    const code = env.nodeEnv === 'development' ? '123456' : generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await getDb().smsCode.upsert({
      where: { userId: user.id },
      create: { userId: user.id, phone, code, expiresAt },
      update: { code, expiresAt },
    });

    if (env.nodeEnv !== 'development') {
      // TODO: integrate SMS provider
    }
    return ok(reply, { message: env.nodeEnv === 'development' ? '开发模式：验证码 123456' : '发送成功' });
  });

  app.post('/auth/login', async (req, reply) => {
    const { phone, code } = req.body as { phone: string; code: string };
    if (!phone || !code) return fail(reply, '参数不完整');

    const user = await getDb().user.findUnique({ where: { phone }, include: { smsCode: true } });
    if (!user) return fail(reply, '用户不存在');

    const smsRecord = user.smsCode;
    if (!smsRecord || smsRecord.code !== code || smsRecord.expiresAt < new Date()) {
      return fail(reply, '验证码错误或已过期');
    }

    const token = app.jwt.sign({ userId: user.id, phone: user.phone }, { expiresIn: '30d' });
    return ok(reply, { token, user: { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt } });
  });

  app.get('/auth/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const user = await getDb().user.findUnique({ where: { id: userId } });
    if (!user) return fail(reply, '用户不存在', 404);
    return ok(reply, { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
  });

  app.patch('/auth/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { nickname, avatarUrl } = req.body as { nickname?: string; avatarUrl?: string };
    const user = await getDb().user.update({
      where: { id: userId },
      data: { nickname, avatarUrl },
    });
    return ok(reply, { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
  });
}
