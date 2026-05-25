import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import * as bcrypt from 'bcryptjs';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';

export async function authRoutes(app: FastifyInstance) {
  // ── 注册（手机号 + 密码，无验证码）────────────────────
  app.post('/auth/register', async (req, reply) => {
    const { phone, password, nickname } = req.body as {
      phone: string;
      password: string;
      nickname?: string;
    };

    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return fail(reply, '手机号格式不正确');
    if (!password || password.length < 6) return fail(reply, '密码至少6位');

    const exists = await getDb().user.findUnique({ where: { phone } });
    if (exists) return fail(reply, '该手机号已注册', 409);

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await getDb().user.create({
      data: {
        phone,
        passwordHash,
        nickname: nickname?.trim() || '家长',
      },
    });

    const token = app.jwt.sign({ userId: user.id, phone: user.phone }, { expiresIn: '30d' });
    return ok(reply, {
      token,
      user: { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
    });
  });

  // ── 登录（手机号 + 密码）─────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const { phone, password } = req.body as { phone: string; password: string };
    if (!phone || !password) return fail(reply, '参数不完整');

    const user = await getDb().user.findUnique({ where: { phone } });
    if (!user) return fail(reply, '手机号或密码错误');
    if (!user.passwordHash) return fail(reply, '该账号未设置密码，请重新注册');

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return fail(reply, '手机号或密码错误');

    const token = app.jwt.sign({ userId: user.id, phone: user.phone }, { expiresIn: '30d' });
    return ok(reply, {
      token,
      user: { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
    });
  });

  // ── 获取个人资料 ──────────────────────────────────────
  app.get('/auth/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const user = await getDb().user.findUnique({ where: { id: userId } });
    if (!user) return fail(reply, '用户不存在', 404);
    return ok(reply, { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
  });

  // ── 修改个人资料 ──────────────────────────────────────
  app.patch('/auth/profile', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { nickname, avatarUrl } = req.body as { nickname?: string; avatarUrl?: string };
    const user = await getDb().user.update({
      where: { id: userId },
      data: { nickname, avatarUrl },
    });
    return ok(reply, { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
  });

  // ── 修改密码 ──────────────────────────────────────────
  app.post('/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string };
    if (!oldPassword || !newPassword) return fail(reply, '参数不完整');
    if (newPassword.length < 6) return fail(reply, '新密码至少6位');

    const user = await getDb().user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) return fail(reply, '用户不存在');

    const match = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!match) return fail(reply, '原密码错误');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await getDb().user.update({ where: { id: userId }, data: { passwordHash } });
    return ok(reply, { message: '密码修改成功' });
  });
}
