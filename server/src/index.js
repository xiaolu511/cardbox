import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { db } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { analyzeNote } from './analyze.js';
import { splitToCards, answerQuestion, extractOutline, judgeAnswer, refineText } from './llm.js';
import { extractText } from './extract.js';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = Fastify({ logger: true });
const __dirname = dirname(fileURLToPath(import.meta.url));

await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret', sign: { expiresIn: '7d' } });
// 只对显式声明 config.rateLimit 的路由生效（目前是登录/注册）。
// global 开着的话静态文件、/health 也计入同一个 IP 桶，刷新十几次页面就 429、整页变成一行 JSON。
await app.register(rateLimit, { global: false });
// 导入文档：单个文件上限 10MB，只允许一次传一个
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

app.get('/health', async () => ({ ok: true }));

app.setErrorHandler((err, req, reply) => {
  if (err instanceof z.ZodError) return reply.code(400).send({ error: '参数不合法', details: err.issues });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err);
  reply.code(500).send({ error: 'internal error' });
});

// ========== 认证 ==========
const credSchema = z.object({
  username: z.string().trim().min(2).max(32).optional(),
  email: z.string().trim().optional(),
  password: z.string().min(6),
});
const nameOf = (b) => (b.username || b.email || '').trim();

app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const parsed = credSchema.parse(req.body);
  const username = nameOf(parsed);
  if (!username) return reply.code(400).send({ error: '请填写用户名' });
  try {
    const info = db
      .prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
      .run(`${username}@cardbox.local`, username, await hashPassword(parsed.password));
    return { token: app.jwt.sign({ uid: info.lastInsertRowid }) };
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return reply.code(409).send({ error: '这个用户名已经被注册了' });
    throw e;
  }
});

app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const parsed = credSchema.parse(req.body);
  const who = nameOf(parsed);
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE')
    .get(who, who);
  if (!user || !(await verifyPassword(parsed.password, user.password_hash))) {
    return reply.code(401).send({ error: '用户名或密码错误' });
  }
  return { token: app.jwt.sign({ uid: user.id }) };
});

const auth = async (req, reply) => {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
};

// ========== 笔记管理 ==========
app.post('/api/notes', { preHandler: auth }, async (req) => {
  const { raw_text } = z.object({ raw_text: z.string().min(1).max(20000) }).parse(req.body);
  const info = db.prepare('INSERT INTO notes (user_id, raw_text, category_id) VALUES (?, ?, ?)').run(req.user.uid, raw_text, ensureCategory(req.user.uid, '未分类'));
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
});

// 🌟 新增分页参数
app.get('/api/notes', { preHandler: auth }, async (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const notes = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(req.user.uid, limit, offset);
  
  const { total } = db.prepare('SELECT count(*) as total FROM notes WHERE user_id = ?').get(req.user.uid);
  return { data: notes, hasMore: offset + notes.length < total };
});

app.delete('/api/notes/:id', { preHandler: auth }, async (req, reply) => {
  const info = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '笔记不存在' });
  return { ok: true };
});

// ========== 文件导入 ==========
app.post('/api/extract', { preHandler: auth }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: '没有收到文件' });

  const buffer = await file.toBuffer();
  try {
    const text = await extractText(buffer, file.filename);
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return reply.code(422).send({ error: '这个文件里没读到文字，可能是扫描件（需要 OCR，暂不支持）' });
    }
    return { filename: file.filename, text: trimmed.slice(0, 20000), chars: trimmed.length };
  } catch (e) {
    return reply.code(400).send({ error: e.message });
  }
});

// ========== 拆卡 ==========
app.post('/api/notes/:id/cards', { preHandler: auth }, async (req, reply) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!note) return reply.code(404).send({ error: '笔记不存在' });

  const user = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
  const rawCount = Number(req.body?.count);
  const count = Number.isFinite(rawCount) ? Math.min(Math.max(Math.trunc(rawCount), 0), 20) : 0;

  // outline = true：先提炼要点，再按要点拆卡
  let source = note.raw_text;
  if (req.body?.outline) {
    const outline = await extractOutline(note.raw_text, user?.api_key, { lang: req.body?.lang });
    if (outline) source = `以下是这段笔记的要点，请围绕它们出题：\n${outline}`;
  }

  const cards = await splitToCards(source, user?.api_key, { lang: req.body?.lang, count });

  const insert = db.prepare('INSERT OR IGNORE INTO cards (note_id, question, answer, tags) VALUES (?, ?, ?, ?)');
  let createdCount = 0;
  const tx = db.transaction((list) => {
    for (const c of list) {
      const info = insert.run(note.id, c.question, c.answer, JSON.stringify(c.tags));
      createdCount += info.changes;
    }
  });
  tx(cards);
  return { created: createdCount, msg: createdCount === 0 ? '卡片已存在' : '成功添加' };
});

// ========== 卡片管理 & 搜索 ==========
// 🌟 新增分页参数
app.get('/api/cards', { preHandler: auth }, async (req) => {
  const q = String(req.query.q ?? '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.max(1, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  let query = '';
  let countQuery = '';
  let params = [req.user.uid];
  let countParams = [req.user.uid];

  if (!q) {
    query = `SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ? ORDER BY c.id DESC LIMIT ? OFFSET ?`;
    countQuery = `SELECT count(*) as total FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ?`;
  } else if (q.length < 3) {
    const like = `%${q}%`;
    query = `SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ? AND (c.question LIKE ? OR c.answer LIKE ?) ORDER BY c.id DESC LIMIT ? OFFSET ?`;
    countQuery = `SELECT count(*) as total FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ? AND (c.question LIKE ? OR c.answer LIKE ?)`;
    params = [req.user.uid, like, like, limit, offset];
    countParams = [req.user.uid, like, like];
  } else {
    query = `SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id JOIN cards_fts f ON f.rowid = c.id WHERE n.user_id = ? AND cards_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`;
    countQuery = `SELECT count(*) as total FROM cards c JOIN notes n ON n.id = c.note_id JOIN cards_fts f ON f.rowid = c.id WHERE n.user_id = ? AND cards_fts MATCH ?`;
    params = [req.user.uid, `"${q}"`, limit, offset];
    countParams = [req.user.uid, `"${q}"`];
  }

  if (!q) params.push(limit, offset); // 仅有无搜索词时需要加 limit/offset
  else if (q.length >= 3) params.push(limit, offset); // FTS 需要加
  
  const cards = db.prepare(query).all(...params);
  const { total } = db.prepare(countQuery).get(...countParams);

  return { data: cards, hasMore: offset + cards.length < total };
});

app.delete('/api/cards/:id', { preHandler: auth }, async (req, reply) => {
  const info = db.prepare(`DELETE FROM cards WHERE id = ? AND note_id IN (SELECT id FROM notes WHERE user_id = ?)`).run(req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '卡片不存在' });
  return { ok: true };
});

// 改卡片的问题/答案（用户在卡片页点了铅笔）
app.patch('/api/cards/:id', { preHandler: auth }, async (req, reply) => {
  const { question, answer } = req.body ?? {};
  const q = typeof question === 'string' ? question.trim() : null;
  const a = typeof answer === 'string' ? answer.trim() : null;
  if (q === null && a === null) return reply.code(400).send({ error: '没有要更新的内容' });
  if (q !== null && (q.length === 0 || q.length > 500)) return reply.code(400).send({ error: '问题不能为空且不超过 500 字' });
  if (a !== null && (a.length === 0 || a.length > 5000)) return reply.code(400).send({ error: '答案不能为空且不超过 5000 字' });

  const sets = [];
  const params = [];
  if (q !== null) { sets.push('question = ?'); params.push(q); }
  if (a !== null) { sets.push('answer = ?'); params.push(a); }
  const info = db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ? AND note_id IN (SELECT id FROM notes WHERE user_id = ?)`)
    .run(...params, req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '卡片不存在' });

  const card = db.prepare('SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ?').get(req.params.id);
  return { data: card };
});

// 让 AI 按（可能改过的）问题重写这张卡的答案
app.post('/api/cards/:id/regen', { preHandler: auth }, async (req, reply) => {
  const { question, lang } = req.body ?? {};
  const card = db.prepare('SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ? AND n.user_id = ?')
    .get(req.params.id, req.user.uid);
  if (!card) return reply.code(404).send({ error: '卡片不存在' });

  const nextQuestion = (typeof question === 'string' && question.trim()) || card.question;
  if (nextQuestion.length > 500) return reply.code(400).send({ error: '问题不能超过 500 字' });

  try {
    const user = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
    const answer = await answerQuestion(nextQuestion, card.note_text, user?.api_key, lang);
    db.prepare('UPDATE cards SET question = ?, answer = ? WHERE id = ?').run(nextQuestion, answer, card.id);
    return { data: { ...card, question: nextQuestion, answer } };
  } catch (e) {
    return reply.code(502).send({ error: `AI 重答失败: ${e.message}` });
  }
});

// 学员先自己作答，再由 AI 比对标准答案评判；太敷衍的答案不让过
app.post('/api/cards/:id/judge', { preHandler: auth }, async (req, reply) => {
  const { answer, lang } = req.body ?? {};
  const typed = typeof answer === 'string' ? answer.trim() : '';
  const strictness = ['strict', 'normal', 'loose'].includes(req.body?.strictness) ? req.body.strictness : 'normal';
  if (!typed) return reply.code(400).send({ error: '答案不能为空' });
  if (typed.length > 2000) return reply.code(400).send({ error: '答案不超过 2000 字' });

  const card = db.prepare(
    'SELECT c.*, n.raw_text as note_text FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ? AND n.user_id = ?'
  ).get(req.params.id, req.user.uid);
  if (!card) return reply.code(404).send({ error: '卡片不存在' });

  // 一眼就能看出在敷衍的，不必麻烦模型
  const lazy = /^(不知道|不会|不清楚|是|对|恩|嗯|无|没有|忘了|不记得|idk|no idea|dunno|yes|no|ok)[.!。！？]*$/i;
  if (typed.length < 4 || lazy.test(typed)) {
    return { data: { verdict: 'too_simple', comment: '答案太简单了，把你知道的写具体一点。' } };
  }

  try {
    const user = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
    const result = await judgeAnswer(card.question, card.answer, typed, user?.api_key, lang, strictness);
    return { data: result };
  } catch (e) {
    return reply.code(502).send({ error: `AI 评判失败: ${e.message}` });
  }
});

// 保存笔记前先精简提炼
app.post('/api/refine', { preHandler: auth }, async (req, reply) => {
  const { text, lang } = req.body ?? {};
  const raw = typeof text === 'string' ? text.trim() : '';
  if (raw.length < 10) return reply.code(400).send({ error: '内容太短，不需要精简' });
  if (raw.length > 20000) return reply.code(400).send({ error: '内容太长了，请分段处理' });

  try {
    const user = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
    const refined = await refineText(raw, user?.api_key, { lang });
    return { data: { text: refined } };
  } catch (e) {
    return reply.code(502).send({ error: `精简失败: ${e.message}` });
  }
});


// ========== 笔记分析：知识 / 待办 / 重要事项 ==========
const ANALYSIS_LIMIT = { cards: 20, todos: 20, important: 20 };

async function userKey(userId) {
  const row = db.prepare('SELECT api_key FROM users WHERE id = ?').get(userId);
  return row && row.api_key ? row.api_key : '';
}

function pickCategory(userId, name) {
  const trimmed = String(name || '').trim().slice(0, 40);
  if (!trimmed) return null;
  const found = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, trimmed);
  if (found) return found.id;
  const info = db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(userId, trimmed);
  return Number(info.lastInsertRowid);
}

// 找不到就建；给「未分类」这类系统分类用
function ensureCategory(userId, name) {
  const found = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, name);
  if (found) return found.id;
  const info = db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(userId, name);
  return Number(info.lastInsertRowid);
}

app.post('/api/notes/:id/analyze', { preHandler: auth }, async (req, reply) => {
  const note = db.prepare('SELECT id, raw_text FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!note) return reply.code(404).send({ error: '笔记不存在' });
  const instruction = String(req.body && req.body.instruction || '').slice(0, 500);
  const thinking = ['fast', 'standard', 'deep'].includes(req.body && req.body.thinking) ? req.body.thinking : 'standard';
  const lang = ['zhCN', 'zhTW', 'en'].includes(req.body && req.body.lang) ? req.body.lang : 'zhCN';
  try {
    const key = await userKey(req.user.uid);
    const result = await analyzeNote(note.raw_text, key, { lang, instruction, thinking });
    return {
      summary: result.summary,
      category: result.category || '',
      cards: result.cards.slice(0, ANALYSIS_LIMIT.cards),
      todos: result.todos.slice(0, ANALYSIS_LIMIT.todos),
      important: result.important.slice(0, ANALYSIS_LIMIT.important),
      mock: !!result.mock,
    };
  } catch (e) {
    req.log.error(e, 'analyze failed');
    return reply.code(502).send({ error: '分析失败：' + e.message });
  }
});

app.post('/api/notes/:id/apply', { preHandler: auth }, async (req, reply) => {
  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!note) return reply.code(404).send({ error: '笔记不存在' });
  const body = req.body || {};
  const data = body.analysis || {};
  let categoryId = null;
  if (body.categoryId) {
    const own = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(body.categoryId, req.user.uid);
    if (!own) return reply.code(400).send({ error: '分类不存在' });
    categoryId = own.id;
  } else {
    categoryId = pickCategory(req.user.uid, body.categoryName || data.category);
  }

  const tx = db.transaction(() => {
    let cards = 0, todos = 0, important = 0;
    const insCard = db.prepare('INSERT OR IGNORE INTO cards (note_id, question, answer, tags) VALUES (?, ?, ?, ?)');
    const insTodo = db.prepare('INSERT INTO todos (user_id, note_id, title, due_at) VALUES (?, ?, ?, ?)');
    const insImp = db.prepare('INSERT INTO important_items (user_id, note_id, title, detail) VALUES (?, ?, ?, ?)');
    // 重复分析同一条笔记：按「去掉空白与标点」的问题文本比对，命中就更新答案，不重复插卡
    const norm = (v) => String(v || '').toLowerCase().replace(/[\s\p{P}]+/gu, '');
    const cardIndex = new Map(
      db.prepare('SELECT id, question FROM cards WHERE note_id = ?').all(note.id).map((c) => [norm(c.question), c.id])
    );
    const updCard = db.prepare('UPDATE cards SET answer = ?, tags = ? WHERE id = ?');
    for (const c of (data.cards || [])) {
      const q = String(c.question || '').trim().slice(0, 500);
      const a = String(c.answer || '').trim().slice(0, 5000);
      if (!q || !a) continue;
      const tags = JSON.stringify(Array.isArray(c.tags) ? c.tags.slice(0, 6) : []);
      const key = norm(q);
      const hit = cardIndex.get(key);
      if (hit) {
        updCard.run(a, tags, hit);
        cards += 1;
      } else {
        const info = insCard.run(note.id, q, a, tags);
        if (info.changes) { cardIndex.set(key, Number(info.lastInsertRowid)); cards += 1; }
      }
    }
    for (const t of (data.todos || [])) {
      const title = String(t.title || '').trim().slice(0, 200);
      if (!title) continue;
      const dupTodo = db.prepare('SELECT id FROM todos WHERE note_id = ? AND title = ?').get(note.id, title);
      if (dupTodo) continue;
      insTodo.run(req.user.uid, note.id, title, t.due_at ? String(t.due_at).slice(0, 19) : null);
      todos += 1;
    }
    for (const it of (data.important || [])) {
      const title = String(it.title || '').trim().slice(0, 200);
      if (!title) continue;
      const dupImp = db.prepare('SELECT id FROM important_items WHERE note_id = ? AND title = ?').get(note.id, title);
      if (dupImp) continue;
      insImp.run(req.user.uid, note.id, title, String(it.detail || '').slice(0, 1000));
      important += 1;
    }
    if (categoryId) db.prepare('UPDATE notes SET category_id = ? WHERE id = ?').run(categoryId, note.id);
    return { cards, todos, important, categoryId };
  });
  const created = tx();
  return { ok: true, created, summary: String(data.summary || '').slice(0, 300) };
});

app.get('/api/categories', { preHandler: auth }, async (req) => {
  const rows = db.prepare([
    'SELECT c.id, c.name, c.created_at,',
    '  (SELECT COUNT(*) FROM notes n WHERE n.category_id = c.id) AS noteCount,',
    '  (SELECT COUNT(*) FROM cards k JOIN notes n ON n.id = k.note_id WHERE n.category_id = c.id) AS cardCount,',
    '  (SELECT COUNT(*) FROM todos t WHERE t.user_id = c.user_id AND t.note_id IN (SELECT id FROM notes WHERE category_id = c.id)) AS todoCount,',
    '  (SELECT COUNT(*) FROM important_items i WHERE i.user_id = c.user_id AND i.note_id IN (SELECT id FROM notes WHERE category_id = c.id)) AS importantCount',
    'FROM categories c WHERE c.user_id = ? ORDER BY c.name',
  ].join(' ')).all(req.user.uid);
  // 给每个分类补两条预览，卡片页列表里不用点进去就能看到
  const todoQ = db.prepare([
    'SELECT t.title, t.status FROM todos t',
    'JOIN notes n ON n.id = t.note_id',
    'WHERE n.category_id = ? AND t.user_id = ? ORDER BY t.status, t.id DESC LIMIT 2',
  ].join(' '));
  const impQ = db.prepare([
    'SELECT i.title FROM important_items i',
    'JOIN notes n ON n.id = i.note_id',
    'WHERE n.category_id = ? AND i.user_id = ? ORDER BY i.id DESC LIMIT 2',
  ].join(' '));
  return rows.map((r) => ({
    ...r,
    previewTodos: todoQ.all(r.id, req.user.uid).map((x) => x.title),
    previewImportant: impQ.all(r.id, req.user.uid).map((x) => x.title),
  }));
});

app.post('/api/categories', { preHandler: auth }, async (req, reply) => {
  const name = String(req.body && req.body.name || '').trim().slice(0, 40);
  if (!name) return reply.code(400).send({ error: '分类名不能为空' });
  const exists = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(req.user.uid, name);
  if (exists) return reply.code(409).send({ error: '已经有这个分类了' });
  const info = db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)').run(req.user.uid, name);
  return { id: Number(info.lastInsertRowid), name };
});

app.delete('/api/categories/:id', { preHandler: auth }, async (req, reply) => {
  const info = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.uid);
  if (!info.changes) return reply.code(404).send({ error: '分类不存在' });
  return { ok: true };
});

app.patch('/api/notes/:id/category', { preHandler: auth }, async (req, reply) => {
  const note = db.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!note) return reply.code(404).send({ error: '笔记不存在' });
  const raw = req.body ? req.body.categoryId : null;
  if (raw === null || raw === undefined || raw === '') {
    db.prepare('UPDATE notes SET category_id = NULL WHERE id = ?').run(note.id);
    return { ok: true, categoryId: null };
  }
  const own = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(raw, req.user.uid);
  if (!own) return reply.code(400).send({ error: '分类不存在' });
  db.prepare('UPDATE notes SET category_id = ? WHERE id = ?').run(own.id, note.id);
  return { ok: true, categoryId: own.id };
});

app.get('/api/categories/:id/overview', { preHandler: auth }, async (req, reply) => {
  const cat = req.params.id === 'all' ? { id: null, name: '全部' } : db.prepare('SELECT id, name FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!cat) return reply.code(404).send({ error: '分类不存在' });
  const scope = req.params.id === 'all' ? '' : ' AND n.category_id = ' + Number(cat.id);
  const cards = db.prepare('SELECT k.id, k.question, k.answer, k.tags, k.next_review, n.id AS note_id, n.raw_text FROM cards k JOIN notes n ON n.id = k.note_id WHERE n.user_id = ?' + scope + ' ORDER BY k.id DESC LIMIT 200').all(req.user.uid);
  const todos = db.prepare('SELECT t.id, t.title, t.due_at, t.remind_before, t.status, t.note_id FROM todos t JOIN notes n ON n.id = t.note_id WHERE n.user_id = ?' + scope + " ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, COALESCE(t.due_at, '9999'), t.id DESC LIMIT 200").all(req.user.uid);
  const important = db.prepare('SELECT i.id, i.title, i.detail, i.note_id FROM important_items i JOIN notes n ON n.id = i.note_id WHERE n.user_id = ?' + scope + ' ORDER BY i.id DESC LIMIT 200').all(req.user.uid);
  const notes = db.prepare('SELECT n.id, n.raw_text, n.created_at FROM notes n WHERE n.user_id = ?' + scope + ' ORDER BY n.id DESC LIMIT 200').all(req.user.uid);
  return { category: cat, cards, todos, important, notes };
});

app.delete('/api/todos/:id', { preHandler: auth }, async (req, reply) => {
  const row = db.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!row) return reply.code(404).send({ error: '待办不存在' });
  db.prepare('DELETE FROM todos WHERE id = ?').run(row.id);
  return { ok: true };
});

app.delete('/api/important/:id', { preHandler: auth }, async (req, reply) => {
  const row = db.prepare('SELECT id FROM important_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!row) return reply.code(404).send({ error: '重要事项不存在' });
  db.prepare('DELETE FROM important_items WHERE id = ?').run(row.id);
  return { ok: true };
});

app.patch('/api/todos/:id', { preHandler: auth }, async (req, reply) => {
  const row = db.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!row) return reply.code(404).send({ error: '待办不存在' });
  const b = req.body || {};
  if (b.status !== undefined) {
    const st = b.status === 'done' ? 'done' : 'open';
    db.prepare('UPDATE todos SET status = ? WHERE id = ?').run(st, row.id);
  }
  if (b.due_at !== undefined) {
    db.prepare('UPDATE todos SET due_at = ? WHERE id = ?').run(b.due_at ? String(b.due_at).slice(0, 19) : null, row.id);
  }
  if (b.remind_before !== undefined) {
    const m = Math.max(0, Math.min(60 * 24 * 7, Number(b.remind_before) || 0));
    db.prepare('UPDATE todos SET remind_before = ? WHERE id = ?').run(m, row.id);
  }
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(row.id);
});

app.get('/api/agenda', { preHandler: auth }, async (req) => {
  const todos = db.prepare("SELECT id, title, due_at, remind_before, status FROM todos WHERE user_id = ? AND status = 'open' ORDER BY COALESCE(due_at, '9999') LIMIT 200").all(req.user.uid);
  const important = db.prepare('SELECT id, title, detail FROM important_items WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.uid);
  return { todos, important };
});

// ========== 学习数据看板 ==========
app.get('/api/stats', { preHandler: auth }, async (req) => {
  // 1. 待复习（今天到期或已过期）
  const { due } = db.prepare(`
    SELECT count(*) as due FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND (c.next_review IS NULL OR datetime(c.next_review) <= datetime('now'))
  `).get(req.user.uid);

  // 2. 已掌握：最近一次评分是「记得」或「太简单」。
  //    之前用的是 datetime(next_review) > now+7d，而 easy 的间隔正好是 7 天，
  //    等值永远不通过 → 已掌握恒为 0。按最近一次评分记账更稳定，也不会随日期漂移。
  const { mastered } = db.prepare(`
    SELECT count(*) as mastered FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND (
      SELECT r.grade FROM review_log r WHERE r.card_id = c.id
      ORDER BY r.graded_at DESC, r.id DESC LIMIT 1
    ) IN ('good', 'easy')
  `).get(req.user.uid);

  // 3. 总卡片数
  const { total } = db.prepare(`
    SELECT count(*) as total FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ?
  `).get(req.user.uid);

  // 4. 今日已复习（本地时区）
  const { todayReviewed } = db.prepare(`
    SELECT count(*) as todayReviewed FROM review_log r
    JOIN cards c ON c.id = r.card_id JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND date(r.graded_at, 'localtime') = date('now', 'localtime')
  `).get(req.user.uid);

  // 5. 近 7 天活跃度（本地时区，由后端按天聚合）
  const rows = db.prepare(`
    SELECT date(r.graded_at, 'localtime') as d, count(*) as c FROM review_log r
    JOIN cards c ON c.id = r.card_id JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND date(r.graded_at, 'localtime') >= date('now', 'localtime', '-6 days')
    GROUP BY d
  `).all(req.user.uid);
  const byDay = new Map(rows.map((r) => [r.d, r.c]));
  const pad = (v) => String(v).padStart(2, '0');
  const last7d = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    last7d.push({ date: key, count: byDay.get(key) || 0 });
  }

  return { due, mastered, total, todayReviewed, last7d };
});

// 复习中心三张卡的详情列表：type = due | today | mastered | unmastered
app.get('/api/stats/cards', { preHandler: auth }, async (req, reply) => {
  const type = req.query.type || 'due';
  const uid = req.user.uid;

  const base = `
    SELECT c.id, c.question, c.answer, c.next_review, c.note_id
    FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ?`;
  // 最近一次评分，用来判断「已掌握」
  const lastGrade = `(SELECT r.grade FROM review_log r WHERE r.card_id = c.id
                      ORDER BY r.graded_at DESC, r.id DESC LIMIT 1)`;

  let sql;
  if (type === 'due') {
    sql = `${base} AND (c.next_review IS NULL OR datetime(c.next_review) <= datetime('now'))
           ORDER BY c.next_review IS NULL DESC, c.next_review ASC`;
  } else if (type === 'today') {
    sql = `${base} AND EXISTS (
             SELECT 1 FROM review_log r
             WHERE r.card_id = c.id AND date(r.graded_at, 'localtime') = date('now', 'localtime')
           ) ORDER BY c.id DESC`;
  } else if (type === 'mastered') {
    sql = `${base} AND ${lastGrade} IN ('good', 'easy') ORDER BY c.id DESC`;
  } else if (type === 'unmastered') {
    sql = `${base} AND (${lastGrade} IS NULL OR ${lastGrade} NOT IN ('good', 'easy')) ORDER BY c.id DESC`;
  } else {
    return reply.code(400).send({ error: '未知的 type' });
  }

  return db.prepare(sql).all(uid);
});

// ========== 复习功能 ==========
app.get('/api/review', { preHandler: auth }, async (req) => {
  const noteId = req.query.note_id;
  
  let query = `
    SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND (c.next_review IS NULL OR datetime(c.next_review) <= datetime('now'))
  `;
  let params = [req.user.uid];

  // 🌟 如果传了 note_id，就只复习这篇笔记里的卡
  if (noteId && noteId !== 'all') {
    query += ` AND c.note_id = ?`;
    params.push(noteId);
  }

  // 不截断：仪表盘显示的「今日待复习」就是这个接口的条数，两处口径必须一致。
  query += ` ORDER BY c.next_review IS NULL DESC, c.next_review ASC`;
  
  return db.prepare(query).all(...params);
});

app.post('/api/cards/:id/review', { preHandler: auth }, async (req, reply) => {
  const { grade } = z.object({ grade: z.enum(['again', 'hard', 'good', 'easy']) }).parse(req.body);
  const card = db.prepare(`SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ? AND n.user_id = ?`).get(req.params.id, req.user.uid);
  if (!card) return reply.code(404).send({ error: 'card not found' });

  const days = { again: 0, hard: 1, good: 3, easy: 7 }[grade];
  const next = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  
  db.prepare('UPDATE cards SET next_review = ? WHERE id = ?').run(next, card.id);
  db.prepare('INSERT INTO review_log (card_id, grade, graded_at) VALUES (?, ?, ?)')
    .run(card.id, grade, new Date().toISOString().slice(0, 19).replace('T', ' '));
  return { next_review: next };
});

// ========== 设置：API Key ==========
// 前端 SettingsPage 一直在调这两个接口，缺了就会掉进下面的 setNotFoundHandler，
// 被统一回成 { error: 'API not found' }，表现是设置页永远存不进 key。
app.get('/api/settings', { preHandler: auth }, async (req) => {
  const row = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
  const key = row?.api_key || '';
  return {
    hasKey: !!key,
    // 只回显首尾，别把完整 key 发回浏览器
    maskedKey: key ? `${key.slice(0, 5)}****${key.slice(-4)}` : '',
  };
});

app.post('/api/settings', { preHandler: auth }, async (req, reply) => {
  const { api_key } = z.object({ api_key: z.string().max(200) }).parse(req.body ?? {});
  const key = api_key.trim();
  if (!key) return reply.code(400).send({ error: 'API Key 不能为空' });
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(key, req.user.uid);
  return { ok: true };
});

// ========== 挂载前端 ==========
await app.register(fastifyStatic, {
  root: process.env.FRONTEND_DIST || join(__dirname, '../../web/dist'),
  prefix: '/',
});

app.setNotFoundHandler((req, reply) => {
  if (req.raw.url.startsWith('/api')) reply.code(404).send({ error: 'API not found' });
  else reply.sendFile('index.html');
});

// ========== 版本检查 ==========
// 真源是 GitHub Release。缓存 10 分钟，免得用户连点把未认证配额（60 次/小时/IP）烧光。
const RELEASE_REPO = 'xiaolu511/cardbox';
const VERSION_TTL = 10 * 60 * 1000;
let versionCache = { at: 0, payload: null };

async function fetchLatestRelease() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Cardbox' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
    const rel = await res.json();
    return {
      latestVersion: String(rel.tag_name || '').replace(/^v/i, ''),
      releaseNotes: rel.body || '',
      downloadUrl: rel.html_url,
      publishedAt: rel.published_at,
    };
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/version', async (req, reply) => {
  if (versionCache.payload && Date.now() - versionCache.at < VERSION_TTL) {
    return versionCache.payload;
  }
  try {
    const payload = await fetchLatestRelease();
    versionCache = { at: Date.now(), payload };
    return payload;
  } catch (e) {
    // 断网/被墙时明确报错，让前端显示「检查失败，重试」，不拿假版本糊弄人
    req.log.warn({ err: e.message }, '获取最新版本失败');
    return reply.code(502).send({ error: '无法连接 GitHub 获取版本信息' });
  }
});

await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
