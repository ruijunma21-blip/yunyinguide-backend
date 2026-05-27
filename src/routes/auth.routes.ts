import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import * as bcrypt from 'bcryptjs';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { addPoints } from './invite.routes';

// 注册/登录：每个 IP 每 15 分钟最多 10 次，防暴力破解
const authRateLimit = {
  config: {
    rateLimit: { max: 10, timeWindow: '15 minutes' },
  },
};

export async function authRoutes(app: FastifyInstance) {
  // ── 注册（手机号 + 密码，无验证码）────────────────────
  app.post('/auth/register', authRateLimit, async (req, reply) => {
    const { phone, password, nickname, inviteCode } = req.body as {
      phone: string;
      password: string;
      nickname?: string;
      inviteCode?: string;  // 可选邀请码
    };

    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) return fail(reply, '手机号格式不正确');
    if (!password || password.length < 8) return fail(reply, '密码至少8位');
    if (!/[a-zA-Z]/.test(password) && !/\d/.test(password)) return fail(reply, '密码需包含字母和数字');

    const exists = await getDb().user.findUnique({ where: { phone } });
    // 故意不区分"已注册"和"格式错误"，防止用户枚举
    if (exists) return fail(reply, '注册失败，请检查信息后重试', 409);

    const passwordHash = await bcrypt.hash(password, 12); // 提高 cost factor
    const db = getDb();
    const user = await db.user.create({
      data: {
        phone,
        passwordHash,
        nickname: (nickname?.trim() || '家长').slice(0, 20),
        status: 'active', // 注册即激活，无需审核
      },
    });

    // 新用户赠送 7 天免费体验
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);
    await db.subscription.create({
      data: { userId: user.id, planType: 'trial', startAt: new Date(), endAt: trialEnd, status: 'active' },
    });

    // 处理邀请码（记录关系，注册成功后积分立即生效）
    if (inviteCode) {
      try {
        const inviterCode = await db.inviteCode.findUnique({
          where: { code: inviteCode.toUpperCase().trim() },
        });
        if (inviterCode && inviterCode.userId !== user.id) {
          await Promise.all([
            db.referral.create({ data: { inviterId: inviterCode.userId, inviteeId: user.id } }),
            db.inviteCode.update({ where: { id: inviterCode.id }, data: { usedCount: { increment: 1 } } }),
          ]);
        }
      } catch {
        // 邀请码处理失败不影响注册流程
      }
    }

    // 生成 token，注册后直接登录（无需再次手动登录）
    const token = app.jwt.sign(
      { userId: user.id, phone: user.phone, tv: 0 },
      { expiresIn: '30d' }
    );
    return ok(reply, {
      token,
      user: { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt },
      isNewUser: true,
      message: '注册成功，已赠送7天会员体验！',
    }, 201);
  });

  // ── 登录（手机号 + 密码）─────────────────────────────
  app.post('/auth/login', authRateLimit, async (req, reply) => {
    const { phone, password } = req.body as { phone: string; password: string };
    if (!phone || !password) return fail(reply, '参数不完整');

    const user = await getDb().user.findUnique({ where: { phone } });

    // 无论用户是否存在都执行 compare，防止时序攻击枚举手机号
    const dummyHash = '$2b$12$invalidhashfortimingnormalization00000000000000000000';
    const hashToCompare = user?.passwordHash ?? dummyHash;
    const match = await bcrypt.compare(password, hashToCompare);

    if (!user || !match) return fail(reply, '手机号或密码错误');
    if (user.status === 'pending') return fail(reply, '账号暂未激活，请联系管理员（微信：Just197791）', 403);
    if (user.status === 'rejected') return fail(reply, '账号已被禁用，请联系管理员（微信：Just197791）', 403);
    if (user.status === 'banned') return fail(reply, '账号已被封禁', 403);

    // 每次登录自增 tokenVersion，使旧设备的 token 失效
    const updated = await getDb().user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    const token = app.jwt.sign(
      { userId: user.id, phone: user.phone, tv: updated.tokenVersion },
      { expiresIn: '30d' }
    );
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
    if (nickname && (nickname.trim().length < 1 || nickname.trim().length > 20)) {
      return fail(reply, '昵称长度需在 1-20 字之间');
    }
    const user = await getDb().user.update({
      where: { id: userId },
      data: {
        ...(nickname !== undefined ? { nickname: nickname.trim() } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    });
    return ok(reply, { id: user.id, phone: user.phone, nickname: user.nickname, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
  });

  // ── 修改密码 ──────────────────────────────────────────
  app.post('/auth/change-password', { preHandler: requireAuth, ...authRateLimit }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string };
    if (!oldPassword || !newPassword) return fail(reply, '参数不完整');
    if (newPassword.length < 8) return fail(reply, '新密码至少8位');

    const user = await getDb().user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) return fail(reply, '用户不存在');

    const match = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!match) return fail(reply, '原密码错误');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await getDb().user.update({ where: { id: userId }, data: { passwordHash } });
    return ok(reply, { message: '密码修改成功' });
  });
}
