import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { format, subDays } from 'date-fns';

export async function homeRoutes(app: FastifyInstance) {
  // ── 首页聚合数据 ──────────────────────────────────────────
  // 一次请求拿到：错题统计、词单统计、打卡连续天数、会员状态
  app.get('/home/stats', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const db = getDb();

    const today = format(new Date(), 'yyyy-MM-dd');

    // 并行拉取所有数据
    const [
      totalErrors,
      pendingErrors,
      weekErrors,
      vocabLists,
      subscription,
      recentUsage,
      latestGrades,
    ] = await Promise.all([
      // 错题总数
      db.errorRecord.count({ where: { userId } }),
      // 待复习（非 mastered）
      db.errorRecord.count({ where: { userId, status: { not: 'mastered' } } }),
      // 本周错题（7天内）
      db.errorRecord.count({
        where: { userId, createdAt: { gte: subDays(new Date(), 7) } },
      }),
      // 词单列表（含单词数 + 已掌握数）
      db.vocabList.findMany({
        where: { userId },
        include: {
          _count: { select: { words: true } },
          words: { where: { mastery: { gte: 4 } }, select: { id: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // 订阅状态
      db.subscription.findUnique({ where: { userId } }),
      // 近 30 天使用记录（计算连续打卡）
      db.dailyUsage.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 30,
        select: { date: true, usageCount: true },
      }),
      // 最新各科成绩（每科取最新一条）
      db.examGrade.findMany({
        where: { userId },
        orderBy: { examDate: 'desc' },
        take: 10,
        select: { subject: true, score: true, fullScore: true, examName: true, examDate: true },
      }),
    ]);

    // 计算连续打卡天数
    let streakDays = 0;
    const usageDateSet = new Set(recentUsage.map(u => u.date));
    for (let i = 0; i <= 30; i++) {
      const d = format(subDays(new Date(), i), 'yyyy-MM-dd');
      if (usageDateSet.has(d)) {
        streakDays++;
      } else if (i > 0) {
        break; // 断了就停止
      }
    }

    // 词单汇总
    const totalWords = vocabLists.reduce((s, l) => s + l._count.words, 0);

    // 今日使用次数
    const todayUsage = recentUsage.find(u => u.date === today)?.usageCount ?? 0;

    // 会员状态
    const isPremium = !!(subscription && subscription.planType !== 'free'
      && subscription.endAt && subscription.endAt > new Date());
    const premiumEndAt = subscription?.endAt ?? null;

    return ok(reply, {
      errors: {
        total: totalErrors,
        pending: pendingErrors,
        thisWeek: weekErrors,
      },
      vocab: {
        listCount: vocabLists.length,
        totalWords,
        lists: vocabLists.map(l => ({
          id: l.id,
          name: l.name,
          wordCount: l._count.words,
          masteredCount: l.words.length,
        })),
      },
      streakDays,
      todayUsage,
      isPremium,
      premiumEndAt,
      latestGrades: (() => {
        // 每科取最新一条
        const seen = new Set<string>();
        const result: typeof latestGrades = [];
        for (const g of latestGrades) {
          if (!seen.has(g.subject)) { seen.add(g.subject); result.push(g); }
        }
        return result;
      })(),
    });
  });
}
