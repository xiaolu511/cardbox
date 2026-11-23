import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { db } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
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
const credSchema = z.object({ email: z.string().email(), password: z.string().min(6) });

app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { email, password } = credSchema.parse(req.body);
  try {
    const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, await hashPassword(password));
    return { token: app.jwt.sign({ uid: info.lastInsertRowid }) };
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return reply.code(409).send({ error: '邮箱已注册' });
    throw e;
  }
});

app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { email, password } = credSchema.parse(req.body);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return reply.code(401).send({ error: '邮箱或密码错误' });
  }
  return { token: app.jwt.sign({ uid: user.id }) };
});

const auth = async (req, reply) => {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
};

// ========== 笔记管理 ==========
app.post('/api/notes', { preHandler: auth }, async (req) => {
  const { raw_text } = z.object({ raw_text: z.string().min(1).max(20000) }).parse(req.body);
  const info = db.prepare('INSERT INTO notes (user_id, raw_text) VALUES (?, ?)').run(req.user.uid, raw_text);
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
