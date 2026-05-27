import type { FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../utils/db';
import { fail } from '../utils/response';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    const { userId, tv } = request.user as { userId: string; tv?: number };

    // 如果 token 携带了 tv（tokenVersion），校验是否与数据库一致
    // 不一致说明该账号在其他设备重新登录了，踢出当前设备
    if (tv !== undefined) {
      const user = await getDb().user.findUnique({
        where: { id: userId },
        select: { tokenVersion: true, status: true },
      });
      if (!user) return fail(reply, '用户不存在', 401);
      if (user.status === 'banned') return fail(reply, '账号已被封禁', 403);
      if (user.tokenVersion !== tv) return fail(reply, '账号已在其他设备登录，请重新登录', 401);
    }
  } catch {
    fail(reply, '未授权，请先登录', 401);
  }
}
