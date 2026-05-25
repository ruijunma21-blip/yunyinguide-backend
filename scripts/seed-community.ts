/**
 * 社区种子数据脚本
 * 运行: npx tsx scripts/seed-community.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import * as bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const USERS = [
  { phone: '13800000001', nickname: '小明妈妈', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mingmom' },
  { phone: '13800000002', nickname: '浩浩爸爸', nickname2: '浩浩爸', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=haodad' },
  { phone: '13800000003', nickname: '小雨妈', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=yumom' },
  { phone: '13800000004', nickname: '晨晨家长', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=chen' },
  { phone: '13800000005', nickname: '思思的爸爸', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sidaddy' },
  { phone: '13800000006', nickname: '乐乐妈妈', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lemom' },
  { phone: '13800000007', nickname: '轩轩家长', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=xuan' },
  { phone: '13800000008', nickname: '涵涵妈', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=hanmom' },
];

const POSTS = [
  {
    userIdx: 0,
    content: '用了一周AI云引，孩子数学从78分提到了91分！最神奇的是现在做完题会自己检查，说"妈妈你再给我一道类似的"。以前催着做题，现在主动找错。',
    likeCount: 47,
  },
  {
    userIdx: 1,
    content: '分享一个实用技巧：孩子做完错题分析后，让他把"错误原因"用自己的话重新说一遍，比直接看答案记得牢10倍。这个方法配合App里的话术特别好用！',
    likeCount: 38,
  },
  {
    userIdx: 2,
    content: '今天试了引导话术功能，从生活中找比喻解释"分数除法"。孩子突然说"哦！就像把一个比萨分给几个人"，然后后面3道题全做对了。太有成就感了',
    likeCount: 62,
  },
  {
    userIdx: 3,
    content: '请问大家四年级数学的易错点有哪些？我家孩子加减法还行，一到乘除法应用题就卡壳，特别是"路程=速度×时间"那类型的，有经验的家长指导一下吗？',
    likeCount: 15,
  },
  {
    userIdx: 4,
    content: '记录一下今天的进步：孩子语文阅读理解拿了满分！上周用App分析了3道错题，发现他问题在"找中心句"，练了几次这个方法，今天考试就出来了。坚持真的有用',
    likeCount: 29,
  },
  {
    userIdx: 5,
    content: '英语单词模块真的很实用！我家孩子每天睡前背20个单词，一个月下来词汇量涨了好多。而且例句都是他们这个年龄能懂的，不像词典那么难。',
    likeCount: 33,
  },
  {
    userIdx: 6,
    content: '聊聊情绪管理的事。孩子做错题哭了，我没有批评，而是打开App看了分析，然后说"AI说这个知识点你只要再练两道就能掌握了"，孩子立刻擦眼泪说"那我再做两道"。',
    likeCount: 55,
  },
  {
    userIdx: 7,
    content: '周报功能太贴心了，每周一份总结，清楚看到哪科在进步哪科还要加油。现在每周日我都和孩子一起看报告，变成了我们的"复盘时间"，孩子很期待。',
    likeCount: 41,
  },
  {
    userIdx: 0,
    content: '请教一下：孩子写作文总是干巴巴的，事情说清楚了但是读起来没感觉。有没有好的方法帮他增加细节描写？我已经让他多读课外书，但效果不明显',
    likeCount: 22,
  },
  {
    userIdx: 1,
    content: '分享个小发现：每次分析完错题，不要急着做下一道，让孩子闭眼在脑子里把解题步骤过一遍。这叫"心理演练"，配合App的话术引导效果翻倍！',
    likeCount: 44,
  },
  {
    userIdx: 2,
    content: '三年级英语刚开始学，孩子对字母发音很困难。现在用App的单词功能，每个单词都有音标和例句，孩子反而因为好奇"这个字母为什么这么读"开始主动研究了',
    likeCount: 18,
  },
  {
    userIdx: 3,
    content: '今天孩子主动过来说"爸爸，我有道题不太懂，你能用APP帮我分析一下吗？"作为爸爸太欣慰了，从被动到主动，这才是真的成长。',
    likeCount: 71,
  },
  {
    userIdx: 4,
    content: '数学思维题的突破方法：先让孩子把题目画出来或者列表格，App会分析是"方法型"还是"概念型"错误，针对性引导效果很好。五年级的家长可以试试',
    likeCount: 36,
  },
  {
    userIdx: 5,
    content: '误区提醒：家长辅导时不要说"这题太简单了你怎么不会"！这句话会让孩子觉得自己笨。换成"这个知识点有点绕，我们一起看看哪里卡住了"，孩子会更配合',
    likeCount: 88,
  },
  {
    userIdx: 6,
    content: '记录一下感动瞬间：孩子昨天做完作业自己说"妈妈我把错的那道题想明白了"，然后给我解释了5分钟。那个眼睛里的光，是花多少钱都买不到的',
    likeCount: 93,
  },
  {
    userIdx: 7,
    content: '关于错题本的建议：不建议让孩子重新抄一遍题目（太浪费时间），直接用手机拍照+AI分析，比手写效率高很多，而且分析更精准。现在这个时代要用对工具',
    likeCount: 52,
  },
  {
    userIdx: 0,
    content: '二年级语文难点分享：反义词和近义词孩子总分不清。我现在的方法是把反义词做成"打架的一对"（冷↔热、上↔下），孩子觉得有趣很快就记住了',
    likeCount: 27,
  },
  {
    userIdx: 1,
    content: '分数段提升复盘：70→80分主要靠减少粗心错；80→90分需要补知识点漏洞；90→95分要练方法和技巧；95→100分主要靠心态和细心。不同阶段策略不一样',
    likeCount: 64,
  },
];

const COMMENTS: Array<{ postIdx: number; userIdx: number; content: string }> = [
  { postIdx: 0, userIdx: 2, content: '太励志了！请问你们每天用多长时间？' },
  { postIdx: 0, userIdx: 4, content: '我家也在用，确实感觉孩子做题的态度变了很多' },
  { postIdx: 0, userIdx: 6, content: '78到91，进步好大！加油！' },
  { postIdx: 1, userIdx: 0, content: '这个方法好！让孩子自己说出来确实记得更牢' },
  { postIdx: 1, userIdx: 3, content: '试了一下，孩子说了半天说不出来，结果他自己意识到没搞懂😂 效果真的好' },
  { postIdx: 2, userIdx: 1, content: '比萨那个比喻太好了！我要借用' },
  { postIdx: 2, userIdx: 5, content: '生活化比喻就是比教材解释好，孩子更容易接受' },
  { postIdx: 3, userIdx: 1, content: '路程速度时间这类题关键要画线段图，让孩子把已知量都标上去，自然就看清楚了' },
  { postIdx: 3, userIdx: 7, content: '建议多做单位换算练习，很多孩子卡在单位上，不是不懂公式' },
  { postIdx: 5, userIdx: 2, content: '英语单词模块确实很好，音标做得很细致！' },
  { postIdx: 6, userIdx: 4, content: '情绪管理真的太重要了，孩子先稳住情绪才能学进去' },
  { postIdx: 12, userIdx: 0, content: '画图法对我家孩子很有效！特别是行程问题' },
  { postIdx: 13, userIdx: 2, content: '太同意了！这句话杀伤力真的很大，我也注意到说过几次' },
  { postIdx: 14, userIdx: 3, content: '看哭了，这种时刻就是当家长最幸福的时候' },
  { postIdx: 17, userIdx: 5, content: '分阶段策略分析得很有道理，收藏了！' },
];

async function main() {
  console.log('🌱 开始注入社区种子数据...');

  const passwordHash = await bcrypt.hash('password123', 10);

  // 创建用户
  const createdUsers: Array<{ id: string }> = [];
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: { nickname: u.nickname, avatarUrl: u.avatarUrl },
      create: {
        phone: u.phone,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        passwordHash,
      },
    });
    createdUsers.push(user);
    console.log(`  ✓ 用户: ${u.nickname}`);
  }

  // 创建帖子
  const createdPosts: Array<{ id: string }> = [];
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    const daysAgo = Math.floor(Math.random() * 14);
    const post = await prisma.post.create({
      data: {
        userId: createdUsers[p.userIdx].id,
        content: p.content,
        likeCount: p.likeCount,
        commentCount: 0,
        status: 'published',
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 - Math.random() * 86400000),
      },
    });
    createdPosts.push(post);
    console.log(`  ✓ 帖子 ${i + 1}/${POSTS.length}`);
  }

  // 创建评论
  for (const c of COMMENTS) {
    if (c.postIdx >= createdPosts.length) continue;
    await prisma.comment.create({
      data: {
        postId: createdPosts[c.postIdx].id,
        userId: createdUsers[c.userIdx].id,
        content: c.content,
        createdAt: new Date(Date.now() - Math.random() * 7 * 86400000),
      },
    });
  }

  // 更新帖子的 commentCount
  for (let i = 0; i < createdPosts.length; i++) {
    const count = COMMENTS.filter(c => c.postIdx === i).length;
    if (count > 0) {
      await prisma.post.update({
        where: { id: createdPosts[i].id },
        data: { commentCount: count },
      });
    }
  }

  // 创建点赞（随机给一些帖子点赞）
  let likeCount = 0;
  for (let pi = 0; pi < createdPosts.length; pi++) {
    const numLikers = Math.min(Math.floor(POSTS[pi].likeCount / 10), createdUsers.length);
    const shuffled = [...createdUsers].sort(() => Math.random() - 0.5);
    for (let ui = 0; ui < numLikers; ui++) {
      try {
        await prisma.postLike.create({
          data: { postId: createdPosts[pi].id, userId: shuffled[ui].id },
        });
        likeCount++;
      } catch { /* ignore duplicate */ }
    }
  }

  console.log(`\n✅ 种子数据注入完成！`);
  console.log(`   ${createdUsers.length} 个用户`);
  console.log(`   ${createdPosts.length} 条帖子`);
  console.log(`   ${COMMENTS.length} 条评论`);
  console.log(`   ${likeCount} 个点赞`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
