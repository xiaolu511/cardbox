const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

let serverProcess;

// 每台机器一把自己的 JWT 签名密钥，首次启动随机生成并存在 userData 里。
// 不能写死成固定字符串：安装包是发给别人也能用的，密钥一样就等于谁都能伪造 token。
function getOrCreateJwtSecret(userDataPath) {
  const secretPath = path.join(userDataPath, 'jwt-secret');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    return generated;
  } catch (e) {
    // 落盘失败也别退化成公共密钥，宁可本次运行用临时密钥（重启后 token 失效）
    console.error('JWT 密钥落盘失败，本次使用临时密钥:', e);
    return crypto.randomBytes(32).toString('hex');
  }
}

// 数据目录可在设置里改；默认就是 userData。改动只写配置，重启后生效。
function dataDirConfigPath() {
  return path.join(app.getPath('userData'), 'data-dir.json');
}
function readDataDir() {
  try {
    const cfg = JSON.parse(fs.readFileSync(dataDirConfigPath(), 'utf8'));
    if (cfg && typeof cfg.dbDir === 'string' && cfg.dbDir.trim()) return cfg.dbDir;
  } catch {}
  return app.getPath('userData');
}

function startServer() {
  const userDataPath = app.getPath('userData');
  const envPath = path.join(__dirname, 'server', '.env');
  let envVars = { JWT_SECRET: getOrCreateJwtSecret(userDataPath), PORT: '3000', DEEPSEEK_API_KEY: '' };
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) envVars[key.trim()] = value.trim();
    });
  }

  const serverPath = path.join(__dirname, 'server', 'src', 'index.js');
  serverProcess = fork(serverPath, [], {
    // 必须 silent:true。fork 默认继承父进程 stdio，而打包后的 Windows GUI 进程没有控制台，
    // 此时 child.stdout 是 null，下面两行 .on 会抛 TypeError，createWindow 再也执行不到 ——
    // 表现就是「后端起来了但窗口不出现」。
    silent: true,
    env: {
      ...process.env,
      ...envVars,
      DB_DIR: readDataDir(),
      FRONTEND_DIST: path.join(__dirname, 'web', 'dist')
    }
  });

  serverProcess.stdout.on('data', (data) => console.log(`[Server] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data}`));
}

// 🌟 新增：轮询等待后端启动
function waitForServer(url, maxAttempts = 15) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      attempts++;
      if (attempts >= maxAttempts) return reject(new Error(`后端启动超时: ${url}`));
      setTimeout(check, 1000); // 每秒重试一次
    };
    check();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 960, // 拖太小会挤成一列，给个下限
    minHeight: 640,
    title: "Cardbox",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    show: false, // 🌟 核心：先隐藏窗口，杜绝白屏闪烁
    backgroundColor: '#f8fafc', // 🌟 给个初始底色（或者读取用户的深色主题色）
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 🌟 当页面准备好渲染时，再让窗口显示
  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url); // 调用系统浏览器
    }
    return { action: 'deny' }; // 拒绝在应用内打开
  });

  try {
    console.log('正在等待后端启动...');
    await waitForServer('http://localhost:3000/health');
    console.log('后端启动成功，加载页面...');
    win.loadURL('http://localhost:3000');
  } catch (e) {
    console.error(e);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <div style="padding: 40px; font-family: sans-serif; color: #dc2626;">
        <h2>❌ 后端启动失败</h2>
        <p>请检查依赖或杀毒软件拦截。</p>
      </div>
    `));
  }
}

app.whenReady().then(async () => {
  // startServer 抛错也要继续走 createWindow，否则窗口永远不出现、error 页也看不到
  try {
    startServer();
  } catch (e) {
    console.error('启动后端失败:', e);
  }
  await createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
const { ipcMain } = require('electron');

ipcMain.on('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender).minimize();
});
ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender).close();
});
// ===== 恢复出厂：删库 + 删机器级配置 + 清渲染层存储 + 重启 =====
ipcMain.handle('app:factory-reset', async () => {
  try {
    // 1) 先停后端，释放数据库文件句柄（Windows 下占用会删不掉）
    await new Promise((resolve) => {
      if (!serverProcess) return resolve();
      const timer = setTimeout(resolve, 2500);
      serverProcess.once('exit', () => { clearTimeout(timer); resolve(); });
      try { serverProcess.kill(); } catch { clearTimeout(timer); resolve(); }
    });

    // 2) 删当前数据目录里的库文件
    const dir = readDataDir();
    const failed = [];
    for (const f of ['cardbox.db', 'cardbox.db-wal', 'cardbox.db-shm']) {
      const p = path.join(dir, f);
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { if (fs.existsSync(p)) failed.push(p); }
    }

    // 3) 删机器级配置：自定义数据目录、JWT 密钥
    const userData = app.getPath('userData');
    for (const f of ['data-dir.json', 'jwt-secret']) {
      try { fs.unlinkSync(path.join(userData, f)); } catch {}
    }

    // 4) 清掉 localStorage（登录态/主题/字体/语言/判分偏好）
    try { await session.defaultSession.clearStorageData(); } catch {}

    if (failed.length) return { ok: false, error: '文件被占用，删不掉：' + failed.join('、') };

    // 5) 重启，等于重新装了一遍
    setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// ===== 数据目录：选择 / 迁移 / 重启 =====
ipcMain.handle('data-dir:get', () => ({
  current: readDataDir(),
  userData: app.getPath('userData'),
}));

ipcMain.handle('data-dir:choose', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  const r = await dialog.showOpenDialog(win, {
    title: '选择数据保存位置',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('data-dir:set', async (_e, dir) => {
  if (!dir || typeof dir !== 'string') return { ok: false, error: 'bad dir' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const from = readDataDir();
    for (const f of ['cardbox.db', 'cardbox.db-wal', 'cardbox.db-shm']) {
      const src = path.join(from, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
    }
    fs.writeFileSync(dataDirConfigPath(), JSON.stringify({ dbDir: dir }, null, 2), 'utf8');
    setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});
