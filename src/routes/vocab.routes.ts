import { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { requireAuth } from '../middleware/auth.middleware';
import { ok, fail } from '../utils/response';
import { aiService } from '../services/ai.service';

// 艾宾浩斯间隔（天）
const REVIEW_INTERVALS = [0, 1, 3, 7, 14, 30];

function nextReviewDate(mastery: number): Date {
  const days = REVIEW_INTERVALS[Math.min(mastery, REVIEW_INTERVALS.length - 1)];
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export async function vocabRoutes(app: FastifyInstance) {
  // ── 词单 CRUD ─────────────────────────────────────────

  app.get('/lists', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const db = getDb();
    const lists = await db.vocabList.findMany({
      where: { userId },
      include: { _count: { select: { words: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return ok(reply, lists);
  });

  app.post('/lists', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { name, childId, source } = req.body as any;
    if (!name) return fail(reply, '词单名称不能为空', 400);
    const db = getDb();
    const list = await db.vocabList.create({
      data: { userId, name, childId: childId ?? null, source: source ?? 'manual' },
    });
    return ok(reply, list, 201);
  });

  app.delete('/lists/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { id } = req.params as any;
    const db = getDb();
    await db.vocabList.deleteMany({ where: { id, userId } });
    return ok(reply, { deleted: true });
  });

  // ── 单词 CRUD ─────────────────────────────────────────

  app.get('/lists/:listId/words', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { listId } = req.params as any;
    const db = getDb();
    const list = await db.vocabList.findFirst({ where: { id: listId, userId } });
    if (!list) return fail(reply, '词单不存在', 404);
    const words = await db.vocabWord.findMany({
      where: { listId },
      orderBy: { createdAt: 'asc' },
    });
    return ok(reply, words);
  });

  app.post('/lists/:listId/words', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { listId } = req.params as any;
    const { word, meaning, phonetic, example } = req.body as any;
    if (!word || !meaning) return fail(reply, '单词和释义不能为空', 400);
    const db = getDb();
    const list = await db.vocabList.findFirst({ where: { id: listId, userId } });
    if (!list) return fail(reply, '词单不存在', 404);
    const created = await db.vocabWord.create({
      data: { listId, word, meaning, phonetic: phonetic ?? '', example: example ?? '' },
    });
    return ok(reply, created, 201);
  });

  // 批量添加（拍照识别后批量导入）
  app.post('/lists/:listId/words/batch', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { listId } = req.params as any;
    const { words } = req.body as any; // [{word, meaning, phonetic?, example?}]
    if (!Array.isArray(words) || words.length === 0) return fail(reply, '单词列表不能为空', 400);
    const db = getDb();
    const list = await db.vocabList.findFirst({ where: { id: listId, userId } });
    if (!list) return fail(reply, '词单不存在', 404);
    const created = await db.vocabWord.createMany({
      data: words.map((w: any) => ({
        listId,
        word: w.word,
        meaning: w.meaning ?? '',
        phonetic: w.phonetic ?? '',
        example: w.example ?? '',
      })),
    });
    return ok(reply, { count: created.count }, 201);
  });

  app.delete('/words/:wordId', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { wordId } = req.params as any;
    const db = getDb();
    // 验证所有权
    const word = await db.vocabWord.findFirst({
      where: { id: wordId },
      include: { list: { select: { userId: true } } },
    });
    if (!word || word.list.userId !== userId) return fail(reply, '无权操作', 403);
    await db.vocabWord.delete({ where: { id: wordId } });
    return ok(reply, { deleted: true });
  });

  // ── 复习 ──────────────────────────────────────────────

  // 今日待复习单词
  app.get('/review/today', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { listId } = req.query as any;
    const db = getDb();
    const where: any = {
      list: { userId },
      nextReviewAt: { lte: new Date() },
    };
    if (listId) where.listId = listId;
    const words = await db.vocabWord.findMany({
      where,
      orderBy: { nextReviewAt: 'asc' },
      take: 50,
    });
    return ok(reply, words);
  });

  // 提交复习结果
  app.post('/words/:wordId/review', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { wordId } = req.params as any;
    const { result } = req.body as any; // correct | wrong | skip
    const db = getDb();
    const word = await db.vocabWord.findFirst({
      where: { id: wordId },
      include: { list: { select: { userId: true } } },
    });
    if (!word || word.list.userId !== userId) return fail(reply, '无权操作', 403);

    const newMastery = result === 'correct'
      ? Math.min(word.mastery + 1, 5)
      : Math.max(word.mastery - 1, 0);

    const [updated] = await db.$transaction([
      db.vocabWord.update({
        where: { id: wordId },
        data: {
          mastery: newMastery,
          nextReviewAt: nextReviewDate(newMastery),
          reviewCount: { increment: 1 },
        },
      }),
      db.vocabReview.create({ data: { wordId, result } }),
    ]);
    return ok(reply, updated);
  });

  // ── AI 功能 ──────────────────────────────────────────

  // 拍照识别单词（OCR + AI 解析）
  app.post('/scan', { preHandler: requireAuth }, async (req, reply) => {
    const { imageBase64 } = req.body as any;
    if (!imageBase64) return fail(reply, '图片不能为空', 400);
    try {
      const { recognizeText } = await import('../services/ocr.service');
      const text = await recognizeText(imageBase64);
      // AI 从 OCR 文本中提取英语单词列表
      const words = await aiService.extractVocabFromText(text);
      return ok(reply, { rawText: text, words });
    } catch (e: any) {
      return fail(reply, e.message ?? '识别失败', 500);
    }
  });

  // AI 出题测验
  app.post('/quiz', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { listId, count = 10, type = 'mixed' } = req.body as any;
    // type: mixed | en2zh | zh2en | spelling | choice
    const db = getDb();
    const list = await db.vocabList.findFirst({ where: { id: listId, userId } });
    if (!list) return fail(reply, '词单不存在', 404);

    // 优先取掌握度低的单词
    const words = await db.vocabWord.findMany({
      where: { listId },
      orderBy: [{ mastery: 'asc' }, { nextReviewAt: 'asc' }],
      take: Math.min(count * 2, 40),
    });
    if (words.length === 0) return fail(reply, '词单中没有单词', 400);

    const quiz = await aiService.generateVocabQuiz(words, count, type);
    return ok(reply, quiz);
  });

  // AI 为单词补全释义/例句（新增单词时可调用）
  app.post('/words/enrich', { preHandler: requireAuth }, async (req, reply) => {
    const { word } = req.body as any;
    if (!word) return fail(reply, '单词不能为空', 400);
    const enriched = await aiService.enrichWord(word);
    return ok(reply, enriched);
  });
}
