import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from './env';

let prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
  if (!prisma) {
    const pool = new pg.Pool({ connectionString: env.databaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
  }
  return prisma;
}
