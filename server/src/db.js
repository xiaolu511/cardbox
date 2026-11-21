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
-- 复习流水：仪表盘的「近 7 天」「今日已复习」「已掌握」都从这里算，
-- 不再依赖浏览器 localStorage（换机、清缓存就归零）。
CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  graded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id, graded_at);
CREATE INDEX IF NOT EXISTS idx_review_log_time ON review_log(graded_at);
`);

// 2. 修复重复拆卡：给 (note_id, question) 加唯一索引
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_unique ON cards(note_id, question);");
} catch (e) {
  console.log('唯一索引已存在或创建失败:', e.message);
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

  // FTS 是 content='cards' 的外部内容表：老库里的卡片不会自动进索引，需要 rebuild 一次。
  // 但 rebuild 是全量扫描，每次启动都跑会随卡片增长越来越慢，所以用 user_version 记账，只跑一次。
  // 注意：不能靠 count(*) FROM cards_fts 判断是否已建索引——外部内容表的 count 直接读 cards，
  // 两边永远相等，判断恒为「已建好」。
  if (db.pragma('user_version', { simple: true }) < 1) {
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')");
    db.pragma('user_version = 1');
    console.log('✅ FTS5 全文搜索索引初始化完成（已重建历史数据）');
  } else {
    console.log('✅ FTS5 全文搜索索引就绪');
  }
} catch (e) {
  console.log('❌ FTS5 虚表创建或重建失败:', e.message);
}