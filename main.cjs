const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');

let serverProcess;

function startServer() {
  const userDataPath = app.getPath('userData');
  
  // 读取后端的 .env 配置
  const envPath = path.join(__dirname, 'server', '.env');
  let envVars = { JWT_SECRET: 'dev-secret', PORT: '3000', DEEPSEEK_API_KEY: '' };
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) envVars[key.trim()] = value.trim();
    });
  }

  // 启动后端 (传入用户数据路径，保证数据库不会被删除)
  const serverPath = path.join(__dirname, 'server', 'src', 'index.js');
  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      ...envVars,
      DB_DIR: userDataPath,
      FRONTEND_DIST: path.join(__dirname, 'web', 'dist')
    }
  });

  // 打印后端日志到控制台（方便调试）
  serverProcess.stdout.on('data', (data) => console.log(`[Server] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[Server Error] ${data}`));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "Cardbox",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 等待 1.5 秒，确保后端启动完成再加载页面
  setTimeout(() => {
    win.loadURL('http://localhost:3000');
  }, 1500);
}

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill(); // 关软件时，同时杀掉后端进程
  if (process.platform !== 'darwin') app.quit();
});