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

// 用户指定的卡片数量（0 = 让模型自己决定）
const COUNT_SUFFIX = {
  zhCN: (n) => `\n7. 请生成大约 ${n} 张卡片。`,
  zhTW: (n) => `\n7. 請產生大約 ${n} 張卡片。`,
  en: (n) => `\n7. Produce approximately ${n} cards.`,
};

const OUTLINE_PROMPTS = {
  zhCN: '把下面这段笔记提炼成要点清单：每条一行、以「- 」开头、不超过 20 字，最多 10 条。只输出清单，不要任何解释。',
  zhTW: '把下面這段筆記提煉成要點清單：每條一行、以「- 」開頭、不超過 20 字，最多 10 條。只輸出清單，不要任何解釋。',
  en: 'Turn the note below into a bullet list of key points: one per line, starting with "- ", at most 20 words each, max 10 items. Output the list only, no explanation.',
};

const MOCK_CARDS = {
  zhCN: [{ question: '这是一个测试问题吗？', answer: '是的，因为没有填 API Key。', tags: ['测试'] }],
  zhTW: [{ question: '這是一個測試問題嗎？', answer: '是的，因為沒有填 API Key。', tags: ['測試'] }],
  en: [{ question: 'Is this a test question?', answer: 'Yes — no API key is configured.', tags: ['test'] }],
};

async function callDeepSeek(rawText, apiKey, lang, count) {
  // 修复：兜底逻辑，优先用传进来的 key，没有就用 .env 里的
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const base = PROMPTS[lang] || PROMPTS.zhCN;
  const prompt = count > 0 ? base + (COUNT_SUFFIX[lang] || COUNT_SUFFIX.zhCN)(count) : base;

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

export async function splitToCards(rawText, apiKey, { retries = 2, lang = 'zhCN', count = 0 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const text = await callDeepSeek(rawText, apiKey, lang, count);
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

// ========== 单张卡片「重新提问」 ==========
// 用户在卡片页改了问题之后，可以让 AI 按新问题重写答案，依据是这张卡所属的原文笔记。
const ANSWER_PROMPTS = {
  zhCN: `你负责为一张问答卡补写答案。用户会给出「问题」和「原文笔记」。
规则：
1. 答案必须依据笔记内容，简洁准确，不超过 80 字；
2. 语言与笔记原文一致；
3. 只输出 JSON：{"answer":"..."}，不要解释、不要 markdown 代码块。`,
  zhTW: `你負責為一張問答卡補寫答案。使用者會給出「問題」和「原文筆記」。
規則：
1. 答案必須依據筆記內容，精簡準確，不超過 80 字；
2. 語言與筆記原文一致；
3. 只輸出 JSON：{"answer":"..."}，不要解釋、不要 markdown 程式碼區塊。`,
  en: `You write the answer for a single flashcard. The user gives you a question and the source note.
Rules:
1. Base the answer on the note; keep it concise and under 80 words.
2. Use the same language as the note.
3. Output JSON only: {"answer":"..."}. No explanations, no markdown fences.`,
};

const ANSWER_LABELS = {
  zhCN: { q: '问题', n: '原文笔记' },
  zhTW: { q: '問題', n: '原文筆記' },
  en: { q: 'Question', n: 'Source note' },
};

export async function answerQuestion(question, noteText, apiKey, lang = 'zhCN') {
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const L = ANSWER_LABELS[lang] || ANSWER_LABELS.zhCN;

  if (!finalKey) {
    const snippet = String(noteText).slice(0, 40);
    return { zhCN: `（示例答案，未配置 API Key）按笔记内容：${snippet}`,
             zhTW: `（範例答案，未設定 API Key）依筆記內容：${snippet}`,
             en: `(mock answer, no API key) From the note: ${snippet}` }[lang] || snippet;
  }

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
        { role: 'system', content: ANSWER_PROMPTS[lang] || ANSWER_PROMPTS.zhCN },
        { role: 'user', content: `${L.q}：${question}\n\n${L.n}：${noteText}` },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
    signal,
  });

  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(extractJson(text));
  const answer = String(parsed.answer ?? '').trim();
  if (!answer) throw new Error('AI 没有返回答案');
  return answer;
}
// 先把笔记压成要点，再拿要点去拆卡：卡片会更聚焦，也不容易漏主题
export async function extractOutline(rawText, apiKey, { lang = 'zhCN' } = {}) {
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!finalKey) {
    const lines = String(rawText).split(/[。\n！？.!?]/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
    return lines.map((x) => '- ' + x.slice(0, 20)).join('\n');
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${finalKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: OUTLINE_PROMPTS[lang] || OUTLINE_PROMPTS.zhCN },
        { role: 'user', content: rawText },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error('提炼要点失败：HTTP ' + res.status);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ========== 主观题评判：让用户先自己作答，再由 AI 比对标准答案 ==========
const JUDGE_PROMPTS = {
  zhCN: `你是严格的阅卷人。用户会给出「问题」「标准答案」「学员作答」。
规则：
1. 先判断学员作答是否敷衍：字数很少、只写"不知道/是/对/不会"、或与问题无关 → verdict 必须是 "too_simple"；
2. 否则与标准答案比对，给出 verdict：correct（意思到位）、partial（抓对一部分）、wrong（跑题或错误）；
3. comment 用一句话点评，指出漏了什么或错在哪，不超过 40 字；
4. 只输出 JSON：{"verdict":"correct|partial|wrong|too_simple","comment":"..."}，不要解释、不要 markdown。`,
  zhTW: `你是嚴格的閱卷人。使用者會給出「問題」「標準答案」「學員作答」。
規則：
1. 先判斷作答是否敷衍：字數很少、只寫"不知道/是/對/不會"、或與問題無關 → verdict 必須是 "too_simple"；
2. 否則與標準答案比對，verdict 取 correct（意思到位）、partial（抓到一部分）、wrong（離題或錯誤）；
3. comment 用一句話點評，指出漏了什麼或錯在哪，不超過 40 字；
4. 只輸出 JSON：{"verdict":"correct|partial|wrong|too_simple","comment":"..."}，不要解釋、不要 markdown。`,
  en: `You are a strict grader. The user gives you a Question, a Reference answer, and the Learner's answer.
Rules:
1. First check whether the learner is being lazy: very short, just "don't know/yes/no", or off-topic → verdict must be "too_simple".
2. Otherwise compare with the reference: correct, partial, or wrong.
3. comment: one sentence, say what is missing or wrong, under 40 words.
4. Output JSON only: {"verdict":"correct|partial|wrong|too_simple","comment":"..."}. No markdown.`,
};

// 三档严格度：越高越容易判成没记住
const JUDGE_THRESHOLDS = {
  strict: { correct: 0.80, partial: 0.60 },
  normal: { correct: 0.70, partial: 0.45 },
  loose: { correct: 0.55, partial: 0.30 },
};

const JUDGE_LABELS = {
  zhCN: { q: '问题', s: '标准答案', a: '学员作答' },
  zhTW: { q: '問題', s: '標準答案', a: '學員作答' },
  en: { q: 'Question', s: 'Reference answer', a: "Learner's answer" },
};

function overlapRatio(userAnswer, standard) {
  const norm = (s) => String(s).replace(/[\s，。、；：！？""''（）()\[\]{}<>.,;:!?'"\-—]/g, '');
  const u = norm(userAnswer);
  const s = norm(standard);
  if (!u || !s) return 0;
  const set = new Set(s.split(''));
  let hit = 0;
  for (const ch of new Set(u.split(''))) if (set.has(ch)) hit += 1;
  return hit / Math.max(new Set(u.split('')).size, 1);
}

export async function judgeAnswer(question, standard, userAnswer, apiKey, lang = 'zhCN', strictness = 'normal') {
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const answer = String(userAnswer || '').trim();

  if (!finalKey) {
    // 没有 Key 时用字面重合度做个粗糙判断，至少能挡住"不知道"这种
    if (answer.length < 6) {
      return { verdict: 'too_simple', comment: '（示例评判）答案太短，写具体一点。' };
    }
    const r = overlapRatio(answer, standard);
    const score = Math.round(r * 100);
    const th = JUDGE_THRESHOLDS[strictness] || JUDGE_THRESHOLDS.normal;
    if (r >= th.correct) return { score, verdict: 'correct', comment: '（示例评判）要点基本都对上了。' };
    if (r >= th.partial) return { score, verdict: 'partial', comment: '（示例评判）抓到一部分，但不完整。' };
    return { score, verdict: 'wrong', comment: '（示例评判）和标准答案对不上。' };
  }

  const L = JUDGE_LABELS[lang] || JUDGE_LABELS.zhCN;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${finalKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: JUDGE_PROMPTS[lang] || JUDGE_PROMPTS.zhCN },
        { role: 'user', content: `${L.q}：${question}

${L.s}：${standard}

${L.a}：${answer}\n\n评分严格度：${strictness === 'strict' ? '严格' : strictness === 'loose' ? '宽松' : '适中'}（严格时缺关键点就判 partial/wrong，宽松时方向对即可）。` },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error('评判失败：HTTP ' + res.status);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const parsed = JSON.parse(extractJson(text));
  const verdict = ['correct', 'partial', 'wrong', 'too_simple'].includes(parsed.verdict) ? parsed.verdict : 'partial';
  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : verdict === 'correct' ? 90 : verdict === 'partial' ? 60 : verdict === 'too_simple' ? 5 : 25;
  return { score, verdict, comment: String(parsed.comment || '').slice(0, 120) };
}

// ========== 保存笔记前先精简 ==========
const REFINE_PROMPTS = {
  zhCN: `把用户给的一段笔记精简提炼：保留关键概念、结论、步骤，删掉寒暄、重复、无关细节。
规则：
1. 用与原文相同的语言；
2. 长度约为原文的三成到一半，不要加原文没有的内容；
3. 直接输出精简后的正文，不要标题、不要"精简版："这种前缀。`,
  zhTW: `把使用者給的一段筆記精簡提煉：保留關鍵概念、結論、步驟，刪掉寒暄、重複、無關細節。
規則：
1. 用與原文相同的語言；
2. 長度約為原文的三成到一半，不要加原文沒有的內容；
3. 直接輸出精簡後的正文，不要標題、不要"精簡版："這種前綴。`,
  en: `Condense the note the user gives you: keep key concepts, conclusions and steps; drop greetings, repetition and irrelevant detail.
Rules:
1. Same language as the source.
2. About 30-50% of the original length; do not invent content.
3. Output the condensed body only — no title, no "Condensed:" prefix.`,
};

export async function refineText(rawText, apiKey, { lang = 'zhCN' } = {}) {
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const src = String(rawText || '').trim();

  if (!finalKey) {
    // 无 Key：按句子留一半，别切在句子中间
    const sentences = src.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
    const target = Math.max(30, Math.floor(src.length * 0.5));
    let out = '';
    for (const s2 of sentences) {
      if (out.length >= target) break;
      out += s2;
    }
    return (out || src.slice(0, target)) + (out.length < src.length ? '' : '');
  }

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${finalKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: REFINE_PROMPTS[lang] || REFINE_PROMPTS.zhCN },
        { role: 'user', content: src },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error('精简失败：HTTP ' + res.status);
  const data = await res.json();
  const out = data.choices?.[0]?.message?.content?.trim() || '';
  if (!out) throw new Error('AI 没有返回精简结果');
  return out;
}
