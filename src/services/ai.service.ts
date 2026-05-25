import axios from 'axios';
import { env } from '../utils/env';
import { cacheGet, cacheSet } from '../utils/redis';
import * as crypto from 'crypto';

// ── DeepSeek API 调用 ─────────────────────────────────────
async function chat(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800,
  model: 'deepseek-chat' | 'deepseek-reasoner' = 'deepseek-chat',
): Promise<string> {
  const res = await axios.post(
    'https://api.deepseek.com/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${env.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );
  return res.data.choices[0].message.content as string;
}

// ── System Prompts ────────────────────────────────────────
const ANALYSIS_SYSTEM = `你是一位拥有15年教学经验的中国K12教育专家，精通人教版数学、语文、英语课程体系（小学1-6年级）。分析学生错题的根本原因。

错误类型（三选一）：
- careless：粗心型，解题思路对但抄错/计算失误
- concept：概念型，知识点理解有偏差或未掌握
- method：方法型，知识点知道但不会组合运用

置信度：90-100题目明确；70-89有推断；50-69信息不足；<50建议重拍。

输出JSON（不含任何其他内容）：
{"error_type":"careless|concept|method","grade_level":"如五年级上册","knowledge_point":"具体知识点","textbook_chapter":"人教版章节","error_summary":"15字以内","detail_analysis":"3-4句详细分析","confidence":整数0-100,"similar_mistakes":["知识点1","知识点2"]}`;

const GUIDE_SYSTEM = `你是儿童教育心理专家，擅长苏格拉底式引导法。帮家长用对话引导孩子自己想通，绝不直接给答案。

要求：3个步骤，每步script是家长照说的口语（100字内），有fallback方案，语气温和。

输出JSON（不含任何其他内容）：
{"topic":"话术主题","estimated_time":"如8-12分钟","prerequisite_check":"前置确认","steps":[{"step":1,"title":"5字标题","script":"家长说的话","expected_response":"孩子正常回答","fallback":"答不上来怎么办","success_signal":"成功标志"}],"closing":"总结语","parent_tips":"给家长的提示50字"}`;

const VOCAB_EXTRACT_SYSTEM = `从OCR识别的课本/试卷文本中提取英语单词，补全释义和音标。输出JSON数组，无英语单词时输出空数组：
[{"word":"英文单词","meaning":"中文释义","phonetic":"音标如/wɜːrd/","example":"简单例句"}]`;

const VOCAB_ENRICH_SYSTEM = `为英语单词提供中文释义、音标和例句。输出JSON：
{"meaning":"中文释义（可多义）","phonetic":"音标","example":"简单英文例句"}`;

const VOCAB_QUIZ_SYSTEM = `根据单词列表生成测验题目。choice生成4选1，fill生成填空，translate生成翻译，mixed混合。输出JSON：
{"questions":[{"id":"1","type":"choice|fill|translate","word":"单词","question":"题目","options":["A","B","C","D"]或null,"answer":"正确答案","hint":"提示"}]}`;

const GRADES_SYSTEM = `分析学生成绩数据，找出薄弱科目和进步趋势，给家长实用建议。输出JSON：
{"overall":"总体评价30字","trend":"improving|declining|stable","weak_subjects":[{"subject":"科目","avg_score":分数,"suggestion":"建议20字"}],"strong_subjects":[{"subject":"科目","avg_score":分数}],"focus_suggestion":"重点建议50字","encouragement":"鼓励话语30字"}`;

const REPORT_SYSTEM = `你是AI云引Guide数据分析师，将学生错题数据转化为家长友好的学习报告。正向为主，具体可行。
输出JSON：{"week_summary":"20字","total_errors":数字,"trend":"up|down|stable","trend_text":"趋势描述","highlights":[{"type":"progress|concern","subject":"科目","title":"10字","description":"30字"}],"subject_breakdown":[{"subject":"math|chinese|english","error_count":数字,"mastery_level":"strong|medium|weak","top_weakness":"知识点","improvement_tip":"20字"}],"focus_this_week":{"knowledge_point":"知识点","reason":"原因","suggested_practice":"建议"},"encouragement":"30字鼓励"}`;

// ── Types ─────────────────────────────────────────────────
export interface AnalysisInput {
  questionText: string;
  studentAnswer: string;
  correctAnswer: string;
  subject: string;
  grade: number;
}

export interface AnalysisOutput {
  error_type: string;
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

// ── AI Service ────────────────────────────────────────────
export const aiService = {
  async analyzeError(input: AnalysisInput): Promise<AnalysisOutput> {
    const cacheKey = `dsanalysis:${crypto.createHash('md5').update(JSON.stringify(input)).digest('hex')}`;
    const cached = await cacheGet<AnalysisOutput>(cacheKey);
    if (cached) return cached;

    const userMsg = `题目：${input.questionText}\n学生答案：${input.studentAnswer}\n正确答案：${input.correctAnswer}\n科目：${input.subject}，年级：${input.grade}年级`;
    const text = await chat(ANALYSIS_SYSTEM, userMsg, 600);
    const result = JSON.parse(text) as AnalysisOutput;
    await cacheSet(cacheKey, result, 86400);
    return result;
  },

  async generateGuide(input: GuideInput): Promise<unknown> {
    const userMsg = `错误类型：${input.errorType}，科目：${input.subject}，年级：${input.grade}年级\n知识点：${input.knowledgePoint}，错误摘要：${input.errorSummary}\n孩子答案：${input.studentAnswer}，正确答案：${input.correctAnswer}`;
    const text = await chat(GUIDE_SYSTEM, userMsg, 1200);
    return JSON.parse(text);
  },

  async extractVocabFromText(text: string): Promise<{ word: string; meaning: string; phonetic: string; example: string }[]> {
    const cacheKey = `dsvocab:${crypto.createHash('md5').update(text.slice(0, 200)).digest('hex')}`;
    const cached = await cacheGet<{ word: string; meaning: string; phonetic: string; example: string }[]>(cacheKey);
    if (cached) return cached;

    const resultText = await chat(VOCAB_EXTRACT_SYSTEM, `文本内容：\n${text.slice(0, 2000)}`, 1500);
    try {
      const result = JSON.parse(resultText) as { word: string; meaning: string; phonetic: string; example: string }[];
      await cacheSet(cacheKey, result, 3600);
      return result;
    } catch { return []; }
  },

  async enrichWord(word: string): Promise<{ meaning: string; phonetic: string; example: string }> {
    const cacheKey = `dsword:${word}`;
    const cached = await cacheGet<{ meaning: string; phonetic: string; example: string }>(cacheKey);
    if (cached) return cached;

    const text = await chat(VOCAB_ENRICH_SYSTEM, `单词：${word}`, 200);
    try {
      const result = JSON.parse(text) as { meaning: string; phonetic: string; example: string };
      await cacheSet(cacheKey, result, 604800);
      return result;
    } catch { return { meaning: '', phonetic: '', example: '' }; }
  },

  async generateVocabQuiz(words: Array<{ word: string; meaning: string }>, count: number, type: string): Promise<unknown> {
    const wordList = words.slice(0, count).map(w => `${w.word}（${w.meaning}）`).join('、');
    const text = await chat(VOCAB_QUIZ_SYSTEM, `题目数量：${count}，类型：${type}\n单词列表：${wordList}`, 2000);
    try { return JSON.parse(text); } catch { return { questions: [] }; }
  },

  async analyzeGrades(grades: Array<{ subject: string; examName: string; score: number; fullScore: number; examDate: string }>): Promise<unknown> {
    const cacheKey = `dsgrades:${crypto.createHash('md5').update(JSON.stringify(grades)).digest('hex')}`;
    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return cached;

    const summary = grades.map(g => `${g.subject} ${g.examName} ${g.score}/${g.fullScore} (${new Date(g.examDate).toLocaleDateString('zh-CN')})`).join('\n');
    const text = await chat(GRADES_SYSTEM, `成绩记录：\n${summary}`, 800);
    try {
      const result = JSON.parse(text);
      await cacheSet(cacheKey, result, 3600);
      return result;
    } catch { return {}; }
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
    const userMsg = `孩子信息：${data.grade}年级，昵称：${data.childName}\n本周：${data.weekStart}至${data.weekEnd}\n本周错题：${data.totalErrors}道，上周：${data.lastWeekErrors}道\n\n错题明细：\n${data.errorList}`;
    const text = await chat(REPORT_SYSTEM, userMsg, 1000);
    return JSON.parse(text);
  },
};
