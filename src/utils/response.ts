import type { FastifyReply } from 'fastify';

export function ok<T>(reply: FastifyReply, data: T, status = 200) {
  return reply.status(status).send({ success: true, data });
}

export function fail(reply: FastifyReply, message: string, status = 400) {
  return reply.status(status).send({ success: false, message });
}
