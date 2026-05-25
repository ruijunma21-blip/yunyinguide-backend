import type { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { ok, fail } from '../utils/response';
import { requireAuth } from '../middleware/auth.middleware';
import { aiService } from '../services/ai.service';
import { recognizeText } from '../services/ocr.service';
import { env } from '../utils/env';
import { format } from 'date-fns';



const SUBJECT_MAP: Record<string, string> = {
  math: '数学', chinese: '语文', english: '英语',
};

export async function analysisRoutes(app: FastifyInstance) {
  app.get('/analysis/usage', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const today = format(new Date(), 'yyyy-MM-dd');
    const usage = await getDb().dailyUsage.findUnique({ where: { userId_date: { userId, date: today } } });
    const usageCount = usage?.usageCount ?? 0;

    const sub = await getDb().subscription.findUnique({ where: { userId } });
    const isPremium = sub && sub.planType !== 'free' && sub.endAt && sub.endAt > new Date();

    const limit = isPremium ? 9999 : env.freeUsageLimit;
    return ok(reply, { usageCount, limit, remaining: Math.max(0, limit - usageCount) });
  });

  app.post('/analysis/scan', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as { userId: string };
    const { imageBase64, subject, grade, studentAnswer = '', correctAnswer = '', childId } = req.body as {
      imageBase64: string;
      subject: string;
      grade: number;
      studentAnswer?: string;
      correctAnswer?: string;
      childId?: string;
    };

    if (!imageBase64 || !subject || !grade) return fail(reply, '参数不完整');

    const today = format(new Date(), 'yyyy-MM-dd');
    const sub = await getDb().subscription.findUnique({ where: { userId } });
    const isPremium = sub && sub.planType !== 'free' && sub.endAt && sub.endAt > new Date();

    if (!isPremium) {
      const usage = await getDb().dailyUsage.findUnique({ where: { userId_date: { userId, date: today } } });
      if ((usage?.usageCount ?? 0) >= env.freeUsageLimit) {
        return fail(reply, '今日免费次数已用完，请升级会员', 403);
      }
    }

    let questionText = '';
    try {
      questionText = await recognizeText(imageBase64);
    } catch {
      return fail(reply, 'OCR识别失败，请重新拍照');
    }

    if (!questionText) return fail(reply, '无法识别图片文字，请确保拍照清晰');

    let analysisRaw;
    try {
      analysisRaw = await aiService.analyzeError({
        questionText,
        studentAnswer,
        correctAnswer,
        subject: SUBJECT_MAP[subject] ?? subject,
        grade,
      });
    } catch {
      return fail(reply, 'AI分析失败，请稍后重试');
    }

    const effectiveChildId = childId ?? (await getDb().child.findFirst({ where: { userId } }))?.id;
    if (!effectiveChildId) return fail(reply, '请先添加孩子信息', 400);

    const record = await getDb().errorRecord.create({
      data: {
        userId,
        childId: effectiveChildId,
        subject,
        grade,
        questionText,
        studentAnswer,
        correctAnswer,
        errorType: analysisRaw.error_type,
        knowledgePoint: analysisRaw.knowledge_point,
        gradeLevel: analysisRaw.grade_level,
        textbookChapter: analysisRaw.textbook_chapter,
        errorSummary: analysisRaw.error_summary,
        detailAnalysis: analysisRaw.detail_analysis,
        confidence: analysisRaw.confidence,
        similarMistakes: analysisRaw.similar_mistakes,
        status: 'reviewing',
      },
    });

    await getDb().dailyUsage.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today, usageCount: 1 },
      update: { usageCount: { increment: 1 } },
    });

    return ok(reply, {
      ocrText: questionText,
      recordId: record.id,
      analysis: {
        errorType: record.errorType,
        subject: record.subject,
        gradeLevel: record.gradeLevel,
        knowledgePoint: record.knowledgePoint,
        textbookChapter: record.textbookChapter,
        errorSummary: record.errorSummary,
        detailAnalysis: record.detailAnalysis,
        confidence: record.confidence,
        similarMistakes: record.similarMistakes,
      },
    });
  });

  app.post('/analysis/:id/guide', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { userId } = req.user as { userId: string };

    const record = await getDb().errorRecord.findFirst({ where: { id, userId } });
    if (!record) return fail(reply, '记录不存在', 404);

    if (record.guideScript) return ok(reply, record.guideScript);

    let guide;
    try {
      const raw = await aiService.generateGuide({
        errorType: record.errorType,
        subject: SUBJECT_MAP[record.subject] ?? record.subject,
        grade: record.grade,
        knowledgePoint: record.knowledgePoint,
        errorSummary: record.errorSummary,
        studentAnswer: record.studentAnswer,
        correctAnswer: record.correctAnswer,
      }) as Record<string, unknown>;

      guide = {
        topic: raw.topic,
        estimatedTime: raw.estimated_time,
        prerequisiteCheck: raw.prerequisite_check,
        steps: (raw.steps as Array<Record<string, unknown>>)?.map((s) => ({
          step: s.step,
          title: s.title,
          script: s.script,
          expectedResponse: s.expected_response,
          fallback: s.fallback,
          successSignal: s.success_signal,
        })),
        closing: raw.closing,
        parentTips: raw.parent_tips,
      };
    } catch {
      return fail(reply, '话术生成失败，请稍后重试');
    }

    await getDb().errorRecord.update({ where: { id }, data: { guideScript: guide as import('@prisma/client').Prisma.InputJsonValue } });
    return ok(reply, guide);
  });
}
