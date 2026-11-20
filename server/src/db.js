import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 1. 修复路径问题：优先用环境变量传的（Electron用），否则定死在 server/data 下
const dbDir = process.env.DB_DIR || path.join(__dirname, '../data');
mkdirSync(dbDir, { recursive: true });

export const db = new Database(path.join(dbDir, 'cardbox.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  next_review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
CREATE INDEX IF NOT EXISTS idx_cards_next ON cards(next_review);
`);

// 2. 修复重复拆卡：给 (note_id, question) 加唯一索引
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_unique ON cards(note_id, question);");
} catch (e) {
  console.log('唯一索引已存在或创建失败');
}

// 3. 开启 FTS5 全文搜索（解决中文搜索问题，用 trigram 分词器）
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
      question, answer, content='cards', content_rowid='id', tokenize='trigram'
    );
    -- 触发器：自动同步数据到 FTS 表
    CREATE TRIGGER IF NOT EXISTS cards_ai AFTER INSERT ON cards BEGIN
      INSERT INTO cards_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_ad AFTER DELETE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, question, answer) VALUES('delete', old.id, old.question, old.answer);
    END;
    CREATE TRIGGER IF NOT EXISTS cards_au AFTER UPDATE ON cards BEGIN
      INSERT INTO cards_fts(cards_fts, rowid, question, answer) VALUES('delete', old.id, old.question, old.answer);
      INSERT INTO cards_fts(rowid, question, answer) VALUES (new.id, new.question, new.answer);
    END;
  `);
} catch (e) {
  console.log('FTS5 虚表创建失败', e.message);
}