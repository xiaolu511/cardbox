import { z } from 'zod';

const CardSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

const AnalysisSchema = z.object({
  summary: z.string().default(''),
  category: z.string().default(''),
  cards: z.array(CardSchema).default([]),
  todos: z
    .array(z.object({ title: z.string().min(1), due_at: z.string().nullable().optional() }))
    .default([]),
  important: z
    .array(z.object({ title: z.string().min(1), detail: z.string().optional() }))
    .default([]),
});

function extractJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('模型没有返回 JSON');
  return JSON.parse(s.slice(start, end + 1));
}

const ANALYZE_PROMPTS = {
  zhCN: `你是笔记整理助手。读用户给的笔记，做三件事：
1. 用一句话概括内容（summary，不超过 60 字）；
2. 给出一个分类名（category，2-6 个字，例如「英语学习」「项目工作」「生活杂务」；按笔记主题命名，不要用「未分类」）；
3. 把内容拆成三类条目：
   - cards：知识点问答卡，每张只考一个点，答案不超过 80 字，tags 1-3 个关键词；
   - todos：待办事项，title 是可执行的动作用句；笔记里写了时间就填 due_at（YYYY-MM-DD HH:MM，只写日期也可以），没写就给 null；
   - important：重要事项，title 一句话，detail 补充说明（为什么重要、要注意什么）。
只输出 JSON，格式：
{"summary":"...","category":"...","cards":[{"question":"...","answer":"...","tags":["..."]}],"todos":[{"title":"...","due_at":null}],"important":[{"title":"...","detail":"..."}]}
没有的类别给空数组。不要输出解释，不要用 markdown 代码块。内容使用与笔记原文相同的语言。`,
  zhTW: `你是筆記整理助手。讀使用者給的筆記，做三件事：
1. 用一句話概括內容（summary，不超過 60 字）；
2. 給出一個分類名（category，2-6 個字，例如「英語學習」「專案工作」「生活雜務」）；
3. 把內容拆成三類條目：
   - cards：知識點問答卡，每張只考一個點，答案不超過 80 字；
   - todos：待辦事項，title 是可執行的動作用句，有時間就填 due_at（YYYY-MM-DD HH:MM），沒有給 null；
   - important：重要事項，title 一句話，detail 補充說明。
只輸出 JSON：{"summary":"...","category":"...","cards":[...],"todos":[...],"important":[...]}。沒有給空陣列。使用與筆記原文相同的語言。`,
  en: `You organize notes. Read the note and do three things:
1. Summarize it in one sentence (summary, under 60 words).
2. Give one category name (category, 2-4 words, e.g. "English study", "Project work", "Life admin").
3. Split the content into three kinds of items:
   - cards: knowledge question/answer cards, one idea each, answers under 80 words, tags 1-3 keywords;
   - todos: actionable items; if the note mentions a time, put due_at (format YYYY-MM-DD HH:MM), otherwise null;
   - important: items worth flagging, title plus a detail line.
Output JSON only: {"summary":"...","category":"...","cards":[...],"todos":[...],"important":[...]}. Use empty arrays when a kind has nothing. Same language as the note.`,
};

const THINKING = {
  fast: {
    zhCN: '\n速度优先：只挑最关键的 1-3 个知识点，待办与重要事项宁缺毋滥。',
    zhTW: '\n速度優先：只挑最關鍵的 1-3 個知識點。',
    en: '\nSpeed first: pick only the 1-3 most important cards; be strict about todos and important items.',
  },
  standard: { zhCN: '', zhTW: '', en: '' },
  deep: {
    zhCN: '\n深入分析：尽量把笔记里隐含的待办和重要事项也挖出来，知识点可拆得细一些（最多 8 张）。',
    zhTW: '\n深入分析：盡量挖出隱含的待辦與重要事項，知識點可拆細一些（最多 8 張）。',
    en: '\nGo deep: surface implicit todos and important items, and split knowledge points finer (up to 8 cards).',
  },
};

const MOCK = {
  zhCN: {
    summary: '未配置 API Key，下面是本地示例分析。',
    category: '示例分类',
    card: (raw) => ({ question: '这段笔记的核心内容是什么？', answer: String(raw).slice(0, 80), tags: ['示例'] }),
    todo: '整理这段笔记',
    importantTitle: '还没配置 API Key',
    importantDetail: '设置页填入 DeepSeek Key 后重新分析，就能得到真实的分类与条目。',
  },
  zhTW: {
    summary: '未設定 API Key，以下是本機範例分析。',
    category: '範例分類',
    card: (raw) => ({ question: '這段筆記的核心內容是什麼？', answer: String(raw).slice(0, 80), tags: ['範例'] }),
    todo: '整理這段筆記',
    importantTitle: '還沒設定 API Key',
    importantDetail: '在設定頁填入 DeepSeek Key 後重新分析，就能得到真實的分類與條目。',
  },
  en: {
    summary: 'No API key configured — this is a local sample analysis.',
    category: 'Sample',
    card: (raw) => ({ question: 'What is the core of this note?', answer: String(raw).slice(0, 80), tags: ['sample'] }),
    todo: 'Tidy up this note',
    importantTitle: 'No API key yet',
    importantDetail: 'Add a DeepSeek key in Settings and re-run the analysis for real results.',
  },
};

export async function analyzeNote(rawText, apiKey, { lang = 'zhCN', instruction = '', thinking = 'standard' } = {}) {
  const text = String(rawText || '').slice(0, 20000);
  const finalKey = apiKey || process.env.DEEPSEEK_API_KEY;
  const think = THINKING[thinking] || THINKING.standard;

  if (!finalKey) {
    const m = MOCK[lang] || MOCK.zhCN;
    const firstLine = text.split(/[。！？.!?\n]/).map((x) => x.trim()).filter(Boolean)[0] || m.todo;
    return {
      summary: m.summary,
      category: m.category,
      cards: [m.card(text)],
      todos: [{ title: firstLine.slice(0, 40), due_at: null }],
      important: [{ title: m.importantTitle, detail: m.importantDetail }],
      mock: true,
    };
  }

  const extra = instruction ? `\n\n用户额外要求（优先满足）：${instruction}` : '';
  const budget = thinking === 'deep' ? 3000 : thinking === 'fast' ? 1200 : 2000;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${finalKey}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: (ANALYZE_PROMPTS[lang] || ANALYZE_PROMPTS.zhCN) + (think[lang] || '') },
        { role: 'user', content: text + extra },
      ],
      temperature: thinking === 'fast' ? 0.2 : thinking === 'deep' ? 0.7 : 0.4,
      max_tokens: budget,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek 返回 ${res.status}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  const parsed = AnalysisSchema.parse(extractJson(raw));
  return {
    summary: parsed.summary,
    category: parsed.category,
    cards: parsed.cards.slice(0, 20),
    todos: parsed.todos.slice(0, 20),
    important: parsed.important.slice(0, 20),
    mock: false,
  };
}
