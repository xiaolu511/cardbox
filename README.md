[English](README.en.md) | 简体中文

# Cardbox

把随手笔记交给 AI 拆成「问题 + 答案」知识卡片，按间隔重复算法排复习队列，复习时随手打分，下次自动按记忆曲线再出现在你面前。

桌面单机应用，数据全部留在本地。

## 运行结构

```
Electron 外壳
  └─ main.cjs   起一个本地 Fastify 服务，等 /health 通了自己再加载页面
       └─ server/   只监听 127.0.0.1:3000，顺便托管前端静态文件
            └─ React 前端
```

数据流向：

```
笔记原文 / 导入文件 / 拆卡请求
        │
        ▼
  Fastify :3000 ──► DeepSeek API        拆卡、重答、提炼要点
        │
        ├──► mammoth / pdf-parse        docx、pdf → 纯文本
        │
        ▼
  SQLite 单文件（%APPDATA%\Cardbox\cardbox.db）
   ├ users        账号、口令哈希、API Key
   ├ notes        原始笔记
   ├ cards        问答卡片、next_review 下次复习时间
   ├ review_log   每次评分记录，「已掌握」和七日图都从这里算
   └ cards_fts    FTS5 三元组全文索引
```

## 功能

- **笔记 → 卡片**：粘贴一段文字，DeepSeek 拆成多张问答卡片；同一张卡片不会重复生成
- **拆卡前先定规矩**：可选「分析要求」（例如只要概念、忽略例子）、思考程度（快速 / 标准 / 深入），拆的时候能看到读取 → 分析 → 归类 → 写入四步进度
- **文件导入**：支持 `.txt / .md / .docx / .pdf`（单文件 ≤10MB），导入后正文直接进输入框
- **先提炼要点再拆卡**：长文可先让模型压成要点再出题，整篇 PDF 也不至于出题发散
- **折叠与批量**：笔记长内容默认收四行；笔记和卡片都支持多选、全选、批量删除，笔记还能批量拆卡
- **分类自己定**：分类由你新建，AI 不替你归类；没归类的笔记就是没归类，不会凭空多出「未分类」
- **三层界面**：一级菜单在顶栏，左侧是二级（卡片 / 复习 + 分类列表），右侧是主体面板——总览四格加「知识点 / 待办事项 / 重要事项 / 笔记」四个标签
- **待办与重要事项**：分析时顺手把待办和重要事项抽出来；待办可勾完成、有截止时间与提前提醒
- **间隔重复复习**：again / hard / good / easy 四档打分，按记忆曲线算下次复习时间；进入复习后左栏收起，专注答题
- **复习范围**：按分类限范围，也可以直接挑某一张卡片来练
- **复习中心**：今日待复习 / 今日已复习 / 知识库掌握度三张卡，配近 7 天复习活跃度；点开任意一张能看卡片明细，也可以直接「加练」
- **全文搜索**：SQLite FTS5 三元组索引，中文两字词自动回退 LIKE 匹配，搜「测试」也搜得到
- **主题自定义**：5 套预设配色 + 四色取色器 + 自定义字体；面板不透明度与背景图片分开调——壁纸归壁纸，面板归面板
- **字号缩放**：12–24px 整体缩放，界面与输入框同步
- **数据自己管**：库里存哪可以改；「格式化应用」一键恢复出厂，连账号和本地配置一起清掉
- **检查更新**：从 GitHub Releases 读最新版本，比本地新才提示
- **界面语言**：简体中文 / 繁體中文 / English，设置页一键切换
- **本地优先**：SQLite 单文件存储，API Key 只保存在本机，不上传

复习记录由后端 `review_log` 表记账，换机器或清浏览器缓存都不会丢。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Electron 45 |
| 前端 | React 19 + Vite 8 + Tailwind CSS 4 |
| 后端 | Fastify 5 |
| 存储 | better-sqlite3 13（含 FTS5 全文索引） |
| 模型 | DeepSeek API |

## 开发运行

需要 Node.js 20+。

```bash
# 装依赖（根目录的依赖用于打包，前后端各自独立）
npm install
npm install --prefix web
npm install --prefix server

# 配后端环境变量：复制模板后填自己的 DeepSeek API Key
# 也可以在应用里的「设置」页填，存库不进文件
cp server/.env.example server/.env

# 起后端（http://localhost:3000）
npm run dev --prefix server

# 另开一个终端起前端（http://localhost:5173，/api 自动代理到 3000）
npm run dev --prefix web
```

## 打包

```bash
npm run build --prefix web   # 前端产物 → web/dist
npm run build:app            # → dist/Cardbox Setup <版本>.exe
```

> 打包前先退出正在运行的 Cardbox，否则 electron-builder 会报 `EBUSY ... Cardbox.exe`，而且**退出码仍然是 0**，容易误以为成功了。

## 目录结构

```
main.cjs            Electron 主进程：起后端、建窗口、窗口控制与数据目录 IPC
preload.cjs         通过 contextBridge 暴露最小接口（窗口控制、数据目录、格式化）
server/src/         Fastify 服务：认证、笔记、卡片、复习、搜索、设置、导入解析
server/src/extract.js  txt / md / docx / pdf 转纯文本
web/src/            React 前端：笔记 / 卡片（含复习）/ 设置 / 关于
web/src/theme.js    主题、字体、背景图与不透明度的唯一入口，CSS 变量都在这里设
web/src/i18n.js     界面文案与三语翻译（以简体原文为 key）
web/src/switchAnim.js  页面/标签切换的方向动画（左右或上下）
web/src/modalAnim.js   弹窗进出场与退场数据保留
build/icon.ico      应用图标
```

## 数据存在哪

打包版本的数据库和 JWT 密钥都在 `%APPDATA%\Cardbox\`：

```
cardbox.db       SQLite 库（笔记、卡片、复习记录、待办、重要事项、API Key）
jwt-secret       每台机器首次启动随机生成的登录签名密钥
data-dir.json    只有改过保存位置才出现，记着自定义的库目录
```

设置 → 存储设置里能看到当前库路径，也能换到别的盘：换的时候会把 `cardbox.db` 一起复制过去，重启生效。同一页的「格式化应用」会删掉库、密钥和本地配置，相当于重装一遍软件。

开发模式默认写到 `server/data/`，可以用 `DB_DIR` 环境变量改到别处。

## 许可

[MIT](LICENSE)
