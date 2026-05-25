import Anthropic from '@anthropic-ai/sdk';
import { env } from '../utils/env';
import { cacheGet, cacheSet } from '../utils/redis';
import * as crypto from 'crypto';

const ANALYSIS_SYSTEM_PROMPT = `你是一位拥有15年教学经验的中国K12教育专家，精通人教版数学、语文、英语课程体系（小学1-6年级）。你的任务是分析学生错题的根本原因，帮助家长理解孩子哪里出了问题。

分析规则：
- 错误类型必须三选一：careless（粗心型）/concept（概念型）/method（方法型）
- 粗心型：解题思路对但抄错数字符号或单位
- 概念型：知识点理解有偏差或未掌握
- 方法型：知识点知道但不会组合运用

置信度规则：
- 90-100：答案明确错误，知识点清晰可定位
- 70-89：有一定推断，图片质量或题目不完整
- 50-69：图片模糊或题目信息不足
- 50以下：建议重新拍照

必须严格输出 JSON 格式，不含任何解释文字、markdown标记或代码块符号：
{"error_type":"careless|concept|method","subject":"math|chinese|english","grade_level":"如：五年级上册","knowledge_point":"具体到章节的知识点","textbook_chapter":"人教版章节","error_summary":"15字以内家长易懂描述","detail_analysis":"3-4句详细分析","confidence":整数0-100,"similar_mistakes":["相关知识点1","相关知识点2"]}`;

const GUIDE_SYSTEM_PROMPT = `你是儿童教育心理专家，擅长苏格拉底式引导法。帮助家长用口语化对话引导孩子自己想通，绝不直接给答案。

话术要求：
- 必须生成3个步骤，不多不少
- 每步script是家长直接照说的口语，100字以内
- 从孩子熟悉的生活经验出发
- 每步必须有孩子答不上来时的fallback方案
- 语气温和，像朋友聊天

必须严格输出 JSON 格式，不含任何额外文字：
{"topic":"话术主题","estimated_time":"预计时长如：8-12分钟","prerequisite_check":"前置知识确认","steps":[{"step":1,"title":"5字标题","script":"家长说的话","expected_response":"孩子正常回答","fallback":"答不上来怎么办","success_signal":"成功标志"}],"closing":"总结语","parent_tips":"给家长的提示50字以内"}`;

function selectModel(complexity: 'simple' | 'complex' = 'simple') {
  return complexity === 'complex' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5';
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

export interface AnalysisInput {
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  subject: string;
  grade: number;
}

export interface AnalysisOutput {
  error_type: string;
  subject: string;
  grade_level: string;
  knowledge_point: string;
  textbook_chapter: string;
  error_summary: string;
  detail_analysis: string;
  confidence: number;
  similar_mistakes: string[];
}

export interface GuideInput {
  errorType: string;
  subject: string;
  grade: number;
  knowledgePoint: string;
  errorSummary: string;
  studentAnswer: string;
  correctAnswer: string;
}

export const aiService = {
  async analyzeError(input: AnalysisInput): Promise<AnalysisOutput> {
    const cacheKey = `analysis:${crypto.createHash('md5').update(JSON.stringify(input)).digest('hex')}`;
    const cached = await cacheGet<AnalysisOutput>(cacheKey);
    if (cached) return cached;

    const userPrompt = `题目：${input.questionText}\n学生答案：${input.studentAnswer}\n正确答案：${input.correctAnswer}\n科目：${input.subject}，年级：${input.grade}年级`;

    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 600,
      system: [{ type: 'text', text: ANALYSIS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const result = JSON.parse(text.trim()) as AnalysisOutput;
    await cacheSet(cacheKey, result, 86400);
    return result;
  },

  async generateGuide(input: GuideInput): Promise<unknown> {
    const userPrompt = `错误类型：${input.errorType}，科目：${input.subject}，年级：${input.grade}年级\n知识点：${input.knowledgePoint}，错误摘要：${input.errorSummary}\n孩子答案：${input.studentAnswer}，正确答案：${input.correctAnswer}\n风格：温和`;

    const response = await getClient().messages.create({
      model: selectModel('complex'),
      max_tokens: 1200,
      system: [{ type: 'text', text: GUIDE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text.trim());
  },

  // ── 英语单词相关 ─────────────────────────────────────

  async extractVocabFromText(text: string): Promise<{ word: string; meaning: string; phonetic: string; example: string }[]> {
    const SYSTEM = `从OCR识别的课本/试卷文本中提取英语单词，补全释义和音标。必须输出JSON数组，不含任何额外文字：[{"word":"英文单词","meaning":"中文释义","phonetic":"音标如/wɜːrd/","example":"一个简单例句"}]。如果没有英语单词，输出空数组[]。`;
    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `文本内容：\n${text.slice(0, 2000)}` }],
    });
    const t = response.content[0].type === 'text' ? response.content[0].text : '[]';
    try { return JSON.parse(t.trim()); } catch { return []; }
  },

  async enrichWord(word: string): Promise<{ meaning: string; phonetic: string; example: string }> {
    const SYSTEM = `为英语单词提供中文释义、音标和例句。必须输出JSON，不含额外文字：{"meaning":"中文释义（可多义）","phonetic":"音标如/wɜːrd/","example":"一个简单英文例句"}`;
    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `单词：${word}` }],
    });
    const t = response.content[0].type === 'text' ? response.content[0].text : '{}';
    try { return JSON.parse(t.trim()); } catch { return { meaning: '', phonetic: '', example: '' }; }
  },

  async generateVocabQuiz(words: any[], count: number, type: string): Promise<unknown> {
    const SYSTEM = `根据单词列表生成测验题目。必须输出JSON：{"questions":[{"id":"1","type":"choice|fill|translate","word":"单词","question":"题目","options":["A","B","C","D"]或null,"answer":"正确答案","hint":"提示"}]}。type=choice生成4选1，type=fill生成填空，type=translate生成翻译，type=mixed三种混合。`;
    const wordList = words.slice(0, count).map(w => `${w.word}（${w.meaning}）`).join('、');
    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `题目数量：${count}，类型：${type}\n单词列表：${wordList}` }],
    });
    const t = response.content[0].type === 'text' ? response.content[0].text : '{"questions":[]}';
    try { return JSON.parse(t.trim()); } catch { return { questions: [] }; }
  },

  // ── 成绩分析 ──────────────────────────────────────────

  async analyzeGrades(grades: any[]): Promise<unknown> {
    const SYSTEM = `分析学生成绩数据，找出薄弱科目和进步趋势，给家长实用建议。必须输出JSON：{"overall":"总体评价30字","trend":"improving|declining|stable","weak_subjects":[{"subject":"科目","avg_score":分数,"suggestion":"建议20字"}],"strong_subjects":[{"subject":"科目","avg_score":分数}],"focus_suggestion":"重点建议50字","encouragement":"鼓励话语30字"}`;
    const summary = grades.map(g => `${g.subject} ${g.examName} ${g.score}/${g.fullScore} (${new Date(g.examDate).toLocaleDateString('zh-CN')})`).join('\n');
    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `成绩记录：\n${summary}` }],
    });
    const t = response.content[0].type === 'text' ? response.content[0].text : '{}';
    try { return JSON.parse(t.trim()); } catch { return {}; }
  },

  async generateWeeklyReport(data: {
    childName: string;
    grade: number;
    weekStart: string;
    weekEnd: string;
    totalErrors: number;
    lastWeekErrors: number;
    errorList: string;
  }): Promise<unknown> {
    const REPORT_SYSTEM = `你是AI云引Guide的数据分析师，将学生本周错题数据转化为家长友好的学习报告。正向为主，具体可行，数据有温度，言简意赅。
    必须严格输出JSON格式：{"week_summary":"20字以内","total_errors":数字,"trend":"up|down|stable","trend_text":"趋势描述","highlights":[{"type":"progress|concern","subject":"科目","title":"10字以内","description":"30字以内"}],"subject_breakdown":[{"subject":"math|chinese|english","error_count":数字,"mastery_level":"strong|medium|weak","top_weakness":"最薄弱知识点","improvement_tip":"20字建议"}],"focus_this_week":{"knowledge_point":"知识点","reason":"原因","suggested_practice":"具体建议"},"encouragement":"30字以内鼓励"}`;

    const userPrompt = `孩子信息：${data.grade}年级，昵称：${data.childName}\n本周日期：${data.weekStart} 至 ${data.weekEnd}\n本周错题：${data.totalErrors}道，上周：${data.lastWeekErrors}道\n\n错题明细：\n${data.errorList}`;

    const response = await getClient().messages.create({
      model: selectModel('simple'),
      max_tokens: 1000,
      system: [{ type: 'text', text: REPORT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return JSON.parse(text.trim());
  },
};
