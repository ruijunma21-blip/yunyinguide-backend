import { FastifyInstance } from 'fastify';
import { getDb } from '../utils/db';
import { requireAuth } from '../middleware/auth.middleware';
import { ok, fail } from '../utils/response';

// 简单 XSS 防护：去除所有 HTML 标签和危险字符
function sanitize(str: string): string {
  return str
    .replace(/<[^>]*>/g, '')          // 去除 HTML 标签
    .replace(/javascript:/gi, '')      // 去除 js 伪协议
    .replace(/on\w+\s*=/gi, '')        // 去除事件属性 onclick= 等
    .trim();
}

const VALID_TOPICS = ['general', 'method', 'question', 'share', 'resource', 'chat'];

export async function communityRoutes(app: FastifyInstance) {
  // ── 帖子列表（支持 topic 过滤）────────────────────────
  app.get('/posts', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { take = '20', cursor, topic } = req.query as any;
    const db = getDb();

    const where: any = { status: 'published' };
    if (topic && topic !== 'all' && VALID_TOPICS.includes(topic)) where.topic = topic;

    const posts = await db.post.findMany({
      where,
      take: parseInt(take) + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true } },
        _count: { select: { likes: true, comments: true } },
        likes: { where: { userId }, select: { id: true } },
      },
    });

    const hasNext = posts.length > parseInt(take);
    const items = posts.slice(0, parseInt(take)).map(p => ({
      id: p.id,
      content: p.content,
      imageUrl: p.imageUrl,
      topic: p.topic,
      likeCount: p._count.likes,
      commentCount: p._count.comments,
      isLiked: p.likes.length > 0,
      createdAt: p.createdAt,
      author: { id: p.user.id, nickname: p.user.nickname, avatarUrl: p.user.avatarUrl },
      isOwn: p.userId === userId,
    }));

    return ok(reply, { items, nextCursor: hasNext ? items[items.length - 1]?.id : undefined });
  });

  // ── 发帖 ──────────────────────────────────────────────
  app.post('/posts', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { content, imageUrl, topic = 'general' } = req.body as any;

    if (!content || content.trim().length < 5) return fail(reply, '内容至少5个字', 400);
    if (content.length > 500) return fail(reply, '内容不超过500字', 400);

    const cleanContent = sanitize(content);
    if (cleanContent.length < 5) return fail(reply, '内容包含非法字符', 400);
    const safeTopic = VALID_TOPICS.includes(topic) ? topic : 'general';

    const db = getDb();
    const user = await db.user.findUnique({ where: { id: userId }, select: { nickname: true } });

    const post = await db.post.create({
      data: { userId, content: cleanContent, imageUrl, topic: safeTopic },
    });

    return ok(reply, {
      id: post.id,
      content: post.content,
      imageUrl: post.imageUrl,
      topic: post.topic,
      likeCount: 0,
      commentCount: 0,
      isLiked: false,
      isOwn: true,
      createdAt: post.createdAt,
      author: { id: userId, nickname: user?.nickname ?? '用户', avatarUrl: undefined },
    });
  });

  // ── 删帖（仅本人）────────────────────────────────────
  app.delete('/posts/:postId', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { postId } = req.params as any;
    const db = getDb();

    const post = await db.post.findUnique({ where: { id: postId } });
    if (!post) return fail(reply, '帖子不存在', 404);
    if (post.userId !== userId) return fail(reply, '无权删除', 403);

    await db.post.delete({ where: { id: postId } });
    return ok(reply, { deleted: true });
  });

  // ── 举报帖子 ──────────────────────────────────────────
  app.post('/posts/:postId/report', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { postId } = req.params as any;
    const { reason = 'spam' } = req.body as any;
    const db = getDb();

    const post = await db.post.findUnique({ where: { id: postId } });
    if (!post) return fail(reply, '帖子不存在', 404);
    if (post.userId === userId) return fail(reply, '不能举报自己的帖子', 400);

    await db.postReport.upsert({
      where: { postId_userId: { postId, userId } },
      update: { reason },
      create: { postId, userId, reason },
    });
    return ok(reply, { reported: true });
  });

  // ── 点赞 / 取消点赞 ───────────────────────────────────
  app.post('/posts/:postId/like', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { postId } = req.params as any;
    const db = getDb();

    const existing = await db.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existing) {
      await db.postLike.delete({ where: { id: existing.id } });
      await db.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } });
      const post = await db.post.findUnique({ where: { id: postId }, select: { likeCount: true } });
      return ok(reply, { liked: false, likeCount: Math.max(0, post?.likeCount ?? 0) });
    } else {
      await db.postLike.create({ data: { postId, userId } });
      await db.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } });
      const post = await db.post.findUnique({ where: { id: postId }, select: { likeCount: true } });
      return ok(reply, { liked: true, likeCount: post?.likeCount ?? 1 });
    }
  });

  // ── 评论列表 ──────────────────────────────────────────
  app.get('/posts/:postId/comments', { preHandler: requireAuth }, async (req, reply) => {
    const { postId } = req.params as any;
    const db = getDb();

    const comments = await db.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
    });

    return ok(reply, comments.map(c => ({
      id: c.id,
      postId: c.postId,
      content: c.content,
      createdAt: c.createdAt,
      author: { id: c.user.id, nickname: c.user.nickname },
    })));
  });

  // ── 发评论 ────────────────────────────────────────────
  app.post('/posts/:postId/comments', { preHandler: requireAuth }, async (req, reply) => {
    const { userId } = req.user as any;
    const { postId } = req.params as any;
    const { content } = req.body as any;

    if (!content || content.trim().length === 0) return fail(reply, '评论不能为空', 400);
    if (content.length > 200) return fail(reply, '评论不超过200字', 400);

    const cleanComment = sanitize(content);
    if (cleanComment.length === 0) return fail(reply, '评论包含非法字符', 400);

    const db = getDb();
    const user = await db.user.findUnique({ where: { id: userId }, select: { nickname: true } });

    const [comment] = await db.$transaction([
      db.comment.create({ data: { postId, userId, content: cleanComment } }),
      db.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
    ]);

    return ok(reply, {
      id: comment.id,
      postId: comment.postId,
      content: comment.content,
      createdAt: comment.createdAt,
      author: { id: userId, nickname: user?.nickname ?? '用户' },
    });
  });
}
