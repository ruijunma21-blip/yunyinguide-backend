import dotenv from 'dotenv';
dotenv.config();

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'change_this_secret_in_production_min_32_chars',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  baiduOcrApiKey: process.env.BAIDU_OCR_API_KEY ?? '',
  baiduOcrSecretKey: process.env.BAIDU_OCR_SECRET_KEY ?? '',
  jpushAppKey: process.env.JPUSH_APP_KEY ?? '',
  jpushMasterSecret: process.env.JPUSH_MASTER_SECRET ?? '',
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  freeUsageLimit: 3,
};
