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
// 修复：JWT 过期时间 7 天
await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret', sign: { expiresIn: '7d' } });
// 修复：全局限流防爆破
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

// 登录接口加严格限流（1分钟最多5次）
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

// 新增：删除笔记（级联删除卡片）
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

  // 修复：用 INSERT OR IGNORE 防止重复拆卡
  const insert = db.prepare('INSERT OR IGNORE INTO cards (note_id, question, answer, tags) VALUES (?, ?, ?, ?)');
  let createdCount = 0;
  const tx = db.transaction((list) => {
    for (const c of list) {
      const info = insert.run(note.id, c.question, c.answer, JSON.stringify(c.tags));
      createdCount += info.changes;
    }
  });
  tx(cards);
  return { created: createdCount, msg: createdCount === 0 ? '卡片已存在，未重复添加' : '成功添加' };
});

// ========== 卡片管理 & 搜索 ==========
app.get('/api/cards', { preHandler: auth }, async (req) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    return db.prepare(`SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.user_id = ? ORDER BY c.id DESC LIMIT 100`).all(req.user.uid);
  }
  // 修复：换用 FTS5 全文搜索（支持中文 trigram）
  return db.prepare(`
    SELECT c.* FROM cards c 
    JOIN notes n ON n.id = c.note_id 
    JOIN cards_fts f ON f.rowid = c.id
    WHERE n.user_id = ? AND cards_fts MATCH ?
    ORDER BY rank LIMIT 100
  `).all(req.user.uid, `"${q}"`); // FTS5 中文字符串需要加双引号精确匹配
});

// 新增：删除卡片
app.delete('/api/cards/:id', { preHandler: auth }, async (req, reply) => {
  // 注意：因为加了外键约束，直接删卡片对应的 FTS 会被触发器自动处理
  const info = db.prepare(`
    DELETE FROM cards WHERE id = ? AND note_id IN (SELECT id FROM notes WHERE user_id = ?)
  `).run(req.params.id, req.user.uid);
  if (info.changes === 0) return reply.code(404).send({ error: '卡片不存在' });
  return { ok: true };
});

// ========== 复习功能 (v2 核心) ==========
app.get('/api/review', { preHandler: auth }, async (req) => {
  return db.prepare(`
    SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id
    WHERE n.user_id = ? AND (c.next_review IS NULL OR c.next_review <= datetime('now'))
    ORDER BY c.next_review IS NULL DESC, c.next_review ASC LIMIT 20
  `).all(req.user.uid);
});

app.post('/api/cards/:id/review', { preHandler: auth }, async (req, reply) => {
  const { grade } = z.object({ grade: z.enum(['again', 'hard', 'good', 'easy']) }).parse(req.body);
  const card = db.prepare(`SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ? AND n.user_id = ?`).get(req.params.id, req.user.uid);
  if (!card) return reply.code(404).send({ error: 'card not found' });

  // 间隔重复算法（简化版 SM-2）
  const days = { again: 0, hard: 1, good: 3, easy: 7 }[grade];
  const next = new Date(Date.now() + days * 86400_000).toISOString();
  db.prepare('UPDATE cards SET next_review = ? WHERE id = ?').run(next, card.id);
  return { next_review: next };
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