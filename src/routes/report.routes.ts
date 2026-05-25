import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { aiService } from '../services/ai.service';
import { startOfWeek, endOfWeek, format, subWeeks } from 'date-fns';



export async function reportRoutes(app: FastifyInstance) {
  app.get('/report/latest', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const now = new Date();
    const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return generateReport(userId, weekStart, weekEnd, reply);
  });

  app.get('/report/weekly', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { weekStart, weekEnd } = req.query as { weekStart: string; weekEnd: string };
    if (!weekStart || !weekEnd) return fail(reply, '参数不完整');
    return generateReport(userId, weekStart, weekEnd, reply);
  });
}

async function generateReport(userId: string, weekStart: string, weekEnd: string, reply: unknown) {
  const { ok: okFn } = await import('../utils/response');

  const child = await getDb().child.findFirst({ where: { userId } });

  const records = await getDb().errorRecord.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(weekStart), lte: new Date(weekEnd + 'T23:59:59Z') },
    },
  });

  const lastWeekStart = format(subWeeks(new Date(weekStart), 1), 'yyyy-MM-dd');
  const lastWeekEnd = format(subWeeks(new Date(weekEnd), 1), 'yyyy-MM-dd');
  const lastWeekRecords = await getDb().errorRecord.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(lastWeekStart), lte: new Date(lastWeekEnd + 'T23:59:59Z') },
    },
  });

  const errorList = records.map((r) => `${r.subject}|${r.knowledgePoint}|${r.errorType}|${format(r.createdAt, 'MM-dd')}`).join('\n');

  let reportData;
  try {
    const raw = await aiService.generateWeeklyReport({
      childName: child?.nickname ?? '孩子',
      grade: child?.grade ?? 5,
      weekStart,
      weekEnd,
      totalErrors: records.length,
      lastWeekErrors: lastWeekRecords.length,
      errorList: errorList || '（本周暂无错题记录）',
    }) as Record<string, unknown>;

    reportData = {
      weekSummary: raw.week_summary,
      totalErrors: raw.total_errors,
      trend: raw.trend,
      trendText: raw.trend_text,
      highlights: raw.highlights,
      subjectBreakdown: (raw.subject_breakdown as Array<Record<string, unknown>>)?.map((s) => ({
        subject: s.subject,
        errorCount: s.error_count,
        masteryLevel: s.mastery_level,
        topWeakness: s.top_weakness,
        improvementTip: s.improvement_tip,
      })),
      focusThisWeek: {
        knowledgePoint: (raw.focus_this_week as Record<string, unknown>)?.knowledge_point,
        reason: (raw.focus_this_week as Record<string, unknown>)?.reason,
        suggestedPractice: (raw.focus_this_week as Record<string, unknown>)?.suggested_practice,
      },
      encouragement: raw.encouragement,
      weekStart,
      weekEnd,
    };
  } catch {
    return fail(reply as Parameters<typeof fail>[0], '周报生成失败');
  }

  return okFn(reply as Parameters<typeof okFn>[0], reportData);
}
