import { z } from 'zod';

const CardSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
const CardsSchema = z.object({ cards: z.array(CardSchema).min(1) });

// 提示词跟着界面语言走；但卡片内容要求与笔记原文同语言，
// 免得英文界面 + 中文笔记时被硬翻成英文。
const PROMPTS = {
  zhCN: `你是知识卡片生成器。把用户给的笔记拆成若干张「问答卡」。
规则：
1. 每张卡只考一个知识点，问题要能独立看懂；
2. 答案简洁，不超过 80 字；
3. tags 是 1-3 个关键词；
4. 问题与答案使用与笔记原文相同的语言；
5. 只输出 JSON，格式 {"cards":[{"question":"...","answer":"...","tags":["..."]}]}
6. 不要输出解释、不要用 markdown 代码块。`,
  zhTW: `你是知識卡片生成器。把使用者給的筆記拆成若干張「問答卡」。
規則：
1. 每張卡只考一個知識點，問題要能獨立看懂；
2. 答案精簡，不超過 80 字；
3. tags 是 1-3 個關鍵詞；
4. 問題與答案使用與筆記原文相同的語言；
5. 只輸出 JSON，格式 {"cards":[{"question":"...","answer":"...","tags":["..."]}]}
6. 不要輸出解釋、不要用 markdown 程式碼區塊。`,
  en: `You are a flashcard generator. Split the user's note into a set of question-and-answer cards.
Rules:
1. Each card tests exactly one idea, and the question must make sense on its own.
2. Keep each answer under 80 words.
3. tags are 1-3 keywords.
4. Write questions and answers in the same language as the note.
5. Output JSON only: {"cards":[{"question":"...","answer":"...","tags":["..."]}]}
6. No explanations, no markdown code fences.`,
};

const MOCK_CARDS = {
  zhCN: [{ question: '这是一个测试问题吗？', answer: '是的，因为没有填 API Key。', tags: ['测试'] }],
  zhTW: [{ question: '這是一個測試問題嗎？', answer: '是的，因為沒有填 API Key。', tags: ['測試'] }],
  en: [{ question: 'Is this a test question?', answer: 'Yes — no API key is configured.', tags: ['test'] }],
};

async function callDeepSeek(rawText, apiKey, lang) {
  // 修复：兜底逻辑，优先用传进来的 key，没有就用 .env 里的
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const prompt = PROMPTS[lang] || PROMPTS.zhCN;

  if (!finalKey) {
    console.log('[LLM] 未配置 API Key，使用 Mock 数据');
    return JSON.stringify({ cards: MOCK_CARDS[lang] || MOCK_CARDS.zhCN });
  }

  // 修复：Fetch 超时控制（10秒），防止挂死
  const signal = AbortSignal.timeout(10000);

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${finalKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: rawText },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal, // 注入超时信号
  });
  
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('响应里找不到 JSON');
  return body.slice(start, end + 1);
}

export async function splitToCards(rawText, apiKey, { retries = 2, lang = 'zhCN' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await callDeepSeek(rawText, apiKey, lang);
      const parsed = JSON.parse(extractJson(text));
      const { cards } = CardsSchema.parse(parsed);
      return cards;
    } catch (e) {
      lastErr = e;
      console.warn(`[llm] 第 ${attempt + 1} 次失败: ${e.message}`);
    }
  }
  throw new Error(`LLM 拆卡失败: ${lastErr?.message}`);
}