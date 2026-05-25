import dotenv from 'dotenv';
dotenv.config();

// 生产环境缺失关键变量时快速失败，防止以默认值跑起来
function required(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback ?? '';
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`[env] 生产环境缺少必要变量: ${key}`);
  }
  return val;
}

export const env = {
  databaseUrl:        required('DATABASE_URL'),
  redisUrl:           process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret:          required('JWT_SECRET', 'dev_jwt_secret_change_in_prod_32chars'),
  deepseekApiKey:     process.env.DEEPSEEK_API_KEY ?? '',
  baiduOcrApiKey:     process.env.BAIDU_OCR_API_KEY ?? '',
  baiduOcrSecretKey:  process.env.BAIDU_OCR_SECRET_KEY ?? '',
  jpushAppKey:        process.env.JPUSH_APP_KEY ?? '',
  jpushMasterSecret:  process.env.JPUSH_MASTER_SECRET ?? '',
  // ⚠️ 不硬编码 hash，仅从环境变量读取，未配置则管理员登录自动拒绝
  adminEmail:         process.env.ADMIN_EMAIL ?? '',
  adminPasswordHash:  process.env.ADMIN_PASSWORD_HASH ?? '',
  port:               parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv:            process.env.NODE_ENV ?? 'development',
  freeUsageLimit:     3,
};
