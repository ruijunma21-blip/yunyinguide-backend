import dotenv from 'dotenv';
dotenv.config();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'change_this_secret_in_production_min_32_chars',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baiduOcrApiKey: process.env.BAIDU_OCR_API_KEY ?? '',
  baiduOcrSecretKey: process.env.BAIDU_OCR_SECRET_KEY ?? '',
  jpushAppKey: process.env.JPUSH_APP_KEY ?? '',
  jpushMasterSecret: process.env.JPUSH_MASTER_SECRET ?? '',
  adminEmail: process.env.ADMIN_EMAIL ?? 'ruijunma21@gmail.com',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '$2b$10$wV5gV7AEe2mqKjELXDyH0eKlKn8Q2WP.RMcNV4NOqnZrTD6Md/xXS',
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  freeUsageLimit: 3,
};
