import type { FastifyRequest, FastifyReply } from 'fastify';
import { fail } from '../utils/response';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    fail(reply, '未授权，请先登录', 401);
  }
}
