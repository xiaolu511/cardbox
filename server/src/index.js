import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { db } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { splitToCards } from './llm.js';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = Fastify({ logger: true });
const __dirname = dirname(fileURLToPath(import.meta.url));

await app.register(cors, { origin: true });
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret', sign: { expiresIn: '7d' } });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

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

app.get('/api/notes', { preHandler: auth }, async (req) => {
  return db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY id DESC').all(req.user.uid);
});

app.delete('/api/notes/:id', { preHandler: auth }, async (req, reply) => {
  const info = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '笔记不存在' });
  return { ok: true };
});

// ========== 拆卡 ==========
app.post('/api/notes/:id/cards', { preHandler: auth }, async (req, reply) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.uid);
  if (!note) return reply.code(404).send({ error: '笔记不存在' });

  const user = db.prepare('SELECT api_key FROM users WHERE id = ?').get(req.user.uid);
  const cards = await splitToCards(note.raw_text, user?.api_key);

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
app.get('/api/cards', { preHandler: auth }, async (req) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    return db.prepare(`SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ? ORDER BY c.id DESC LIMIT 100`).all(req.user.uid);
  }

  // 修复：小于3个字符回退 LIKE
  if (q.length < 3) {
    const like = `%${q}%`;
    return db.prepare(`
      SELECT c.* FROM cards c 
      JOIN notes n ON n.id = c.note_id 
      WHERE n.user_id = ? AND (c.question LIKE ? OR c.answer LIKE ?)
      ORDER BY c.id DESC LIMIT 100
    `).all(req.user.uid, like, like);
  }

  // 修复：大于等于3字符使用 FTS5
  return db.prepare(`
    SELECT c.* FROM cards c 
    JOIN notes n ON n.id = c.note_id 
    JOIN cards_fts f ON f.rowid = c.id
    WHERE n.user_id = ? AND cards_fts MATCH ?
    ORDER BY rank LIMIT 100
  `).all(req.user.uid, `"${q}"`);
});

app.delete('/api/cards/:id', { preHandler: auth }, async (req, reply) => {
  const info = db.prepare(`
    DELETE FROM cards WHERE id = ? AND note_id IN (SELECT id FROM notes WHERE user_id = ?)
  `).run(req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '卡片不存在' });
  return { ok: true };
});

// ========== 复习功能 (v2 核心) ==========
// 🌟 修复：补上获取复习队列的接口
app.get('/api/review', { preHandler: auth }, async (req) => {
  return db.prepare(`
    SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND (c.next_review IS NULL OR datetime(c.next_review) <= datetime('now'))
    ORDER BY c.next_review IS NULL DESC, c.next_review ASC LIMIT 20
  `).all(req.user.uid);
});

app.post('/api/cards/:id/review', { preHandler: auth }, async (req, reply) => {
  const { grade } = z.object({ grade: z.enum(['again', 'hard', 'good', 'easy']) }).parse(req.body);
  const card = db.prepare(`SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ? AND n.user_id = ?`).get(req.params.id, req.user.uid);
  if (!card) return reply.code(404).send({ error: 'card not found' });

  // 修复：生成 YYYY-MM-DD HH:MM:SS 格式，解决同一天判错的问题
  const days = { again: 0, hard: 1, good: 3, easy: 7 }[grade];
  const next = new Date(Date.now() + days * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  
  db.prepare('UPDATE cards SET next_review = ? WHERE id = ?').run(next, card.id);
  return { next_review: next };
});

// ========== 设置：API Key ==========
// 注意：前端 SettingsPage 从 v0 起就在调 /api/settings，但后端一直没实现，
// 请求落到下面的 setNotFoundHandler，被统一回成 { error: 'API not found' } ——
// 表现就是设置页永远存不进 key，拆卡只能吃 .env 里的那个。这里把两个接口补上。
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

await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });