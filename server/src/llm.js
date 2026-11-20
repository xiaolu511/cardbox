import { z } from 'zod';

const CardSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
const CardsSchema = z.object({ cards: z.array(CardSchema).min(1) });

const SYSTEM_PROMPT = `你是知识卡片生成器。把用户给的笔记拆成若干张「问答卡」。
规则：
1. 每张卡只考一个知识点，问题要能独立看懂；
2. 答案简洁，不超过 80 字；
3. tags 是 1-3 个关键词；
4. 只输出 JSON，格式 {"cards":[{"question":"...","answer":"...","tags":["..."]}]}
5. 不要输出解释、不要用 markdown 代码块。`;

async function callDeepSeek(rawText, apiKey) {
  // 修复：兜底逻辑，优先用传进来的 key，没有就用 .env 里的
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;

  if (!finalKey) {
    console.log('[LLM] 未配置 API Key，使用 Mock 数据');
    return JSON.stringify({
      cards: [{ question: "这是一个测试问题吗？", answer: "是的，因为没有填 API Key。", tags: ["测试"] }]
    });
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
        { role: 'system', content: SYSTEM_PROMPT },
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

export async function splitToCards(rawText, apiKey, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await callDeepSeek(rawText, apiKey);
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