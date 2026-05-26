import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import path from 'path';
import { env } from './utils/env';
import { authRoutes } from './routes/auth.routes';
import { analysisRoutes } from './routes/analysis.routes';
import { errorbookRoutes } from './routes/errorbook.routes';
import { reportRoutes } from './routes/report.routes';
import { childrenRoutes } from './routes/children.routes';
import { reviewRoutes } from './routes/review.routes';
import { paymentRoutes } from './routes/payment.routes';
import { vocabRoutes } from './routes/vocab.routes';
import { gradesRoutes } from './routes/grades.routes';
import { planRoutes } from './routes/plan.routes';
import { communityRoutes } from './routes/community.routes';
import { adminRoutes } from './routes/admin.routes';
import { announcementRoutes } from './routes/announcement.routes';
import { homeRoutes } from './routes/home.routes';
import { inviteRoutes } from './routes/invite.routes';

const app = Fastify({ logger: { level: env.nodeEnv === 'development' ? 'info' : 'warn' } });

async function buildApp() {
  await app.register(fastifyHelmet, {
    // 允许管理后台内联脚本和 Tailwind CDN
    contentSecurityPolicy: false,
  });
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyJwt, { secret: env.jwtSecret });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });

  // 静态文件（管理后台页面）
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    prefix: '/',
    maxAge: 0,
    etag: false,
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const apiV1 = { prefix: '/api/v1' };
  await app.register(authRoutes, apiV1);
  await app.register(analysisRoutes, apiV1);
  await app.register(errorbookRoutes, apiV1);
  await app.register(reportRoutes, apiV1);
  await app.register(childrenRoutes, apiV1);
  await app.register(reviewRoutes, apiV1);
  await app.register(paymentRoutes, apiV1);
  await app.register(vocabRoutes, { prefix: '/api/v1/vocab' });
  await app.register(gradesRoutes, { prefix: '/api/v1/grades' });
  await app.register(planRoutes, { prefix: '/api/v1/plan' });
  await app.register(communityRoutes, { prefix: '/api/v1/community' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(announcementRoutes, { prefix: '/api/v1' });
  await app.register(homeRoutes, { prefix: '/api/v1' });
  await app.register(inviteRoutes, { prefix: '/api/v1' });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    app.log.error(error);
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ success: false, message: status >= 500 ? '服务器内部错误' : error.message });
  });

  return app;
}

buildApp()
  .then(async (server) => {
    try {
      await server.listen({ port: env.port, host: '0.0.0.0' });
      console.log(`AI 云引 Guide 后端已启动 → http://0.0.0.0:${env.port}`);
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  })
  .catch(console.error);
