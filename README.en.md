English | [简体中文](README.md)

# Cardbox

Feed a rough note to the AI and get back question-and-answer flashcards, scheduled by a spaced-repetition algorithm. Grade each card as you review it; the next appearance is worked out for you.

A single-user desktop app. All data stays on your machine.

## How it runs

```
Electron shell
  └─ main.cjs   starts a local Fastify server and only loads the page once /health responds
       └─ server/   listens on 127.0.0.1:3000 only, and serves the built frontend
            └─ React frontend
```

Data flow:

```
note text / imported file / split request
        │
        ▼
  Fastify :3000 ──► DeepSeek API        split into cards, re-answer, outline
        │
        ├──► mammoth / pdf-parse        docx, pdf → plain text
        │
        ▼
  single SQLite file (%APPDATA%\Cardbox\cardbox.db)
   ├ users        account, password hash, API key
   ├ notes        raw notes
   ├ cards        Q&A cards with next_review
   ├ review_log   every grading, source of "mastered" and the 7-day chart
   └ cards_fts    FTS5 trigram full-text index
```

## Features

- **Notes → cards**: paste text and DeepSeek splits it into Q&A cards; the same card is never generated twice
- **Set the rules first**: optional analysis instructions (concepts only, skip examples…), thinking depth (fast / standard / deep) and a four-step progress view (read → analyse → classify → write)
- **File import**: `.txt / .md / .docx / .pdf` (≤10MB each), text lands straight in the editor
- **Outline first**: optionally condense a long document into key points before generating cards
- **Fold & batch**: long notes collapse to four lines; notes and cards support multi-select, select-all and bulk delete, and notes can be split in bulk
- **Your categories, not the AI's**: you create the categories; unclassified notes simply stay unclassified — no phantom "Uncategorised" bucket
- **Three-layer layout**: primary menu in the title bar, secondary panel on the left (Cards / Review + categories), content panel on the right — an overview strip plus Knowledge / To-dos / Important / Notes tabs
- **To-dos & important items**: pulled out of notes during analysis; to-dos can be checked off and carry a due date with an early reminder
- **Spaced repetition**: again / hard / good / easy, each with its own next-review date; the sidebar collapses while you review
- **Review scope**: limit a session to one category, or drill a single card
- **Review Center**: due today / reviewed today / mastery, plus a 7-day activity chart. Click any card to see the list and drill those cards again
- **Full-text search**: SQLite FTS5 trigram index, with automatic LIKE fallback for short Chinese queries
- **Theming**: 5 presets, four colour pickers and custom fonts, plus separate panel-opacity and background-image controls; one-click reset
- **Font scaling**: 12–24px, applied to the whole UI including inputs
- **Your data, your location**: move the database to another folder, or wipe everything with "format the app" (account and local settings included)
- **Update check**: reads the latest GitHub Release and only prompts when it is newer than your build
- **Local first**: one SQLite file, API key never leaves the machine

Review history is stored server-side in a `review_log` table, so it survives a reinstall or a cleared browser cache.

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Electron 45 |
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 |
| Backend | Fastify 5 |
| Storage | better-sqlite3 13 (with FTS5) |
| Model | DeepSeek API |

## Development

Requires Node.js 20+.

```bash
# Install (the root dependencies are used for packaging; web and server are separate)
npm install
npm install --prefix web
npm install --prefix server

# Configure the backend: copy the template, then paste your DeepSeek API key
# You can also set it in the app under Settings — that is stored in the database, not in a file
cp server/.env.example server/.env

# Start the backend (http://localhost:3000)
npm run dev --prefix server

# In another terminal, start the frontend (http://localhost:5173, /api proxied to 3000)
npm run dev --prefix web
```

## Packaging

```bash
npm run build --prefix web   # frontend build → web/dist
npm run build:app            # → dist/Cardbox Setup <version>.exe
```

> Quit the running Cardbox first. Otherwise electron-builder fails with `EBUSY ... Cardbox.exe` and **still exits with code 0**, which is easy to mistake for success.

## Project structure

```
main.cjs            Electron main process: starts the backend, creates the window, window-control IPC
preload.cjs         Minimal window-control bridge via contextBridge
server/src/         Fastify service: auth, notes, cards, review, search, settings, import
server/src/extract.js  txt / md / docx / pdf to plain text
web/src/            React frontend: notes / cards / review / settings / about
web/src/theme.js    Single entry point for theme, fonts, wallpaper and opacities
web/src/switchAnim.js  Direction-aware page/tab transitions
web/src/modalAnim.js   Modal enter/exit animations and last-value retention
web/src/i18n.js     Translations: zh-CN / zh-TW / en
build/icon.ico      App icon
```

## Where the data lives

The packaged build keeps its database and JWT secret in `%APPDATA%\Cardbox\`:

```
cardbox.db       SQLite database (notes, cards, review log, to-dos, important items, API key)
jwt-secret       Random per-machine signing key, generated on first launch
data-dir.json    Only present after you move the database, remembers the custom folder
```

Settings → Storage shows the current database path and lets you move it to another drive; the database is copied over and applied on restart. "Format the app" on the same page deletes the database, the secret and local settings — the equivalent of a clean reinstall.

In development mode the database goes to `server/data/`; set `DB_DIR` to move it elsewhere.

## License

[MIT](LICENSE)
