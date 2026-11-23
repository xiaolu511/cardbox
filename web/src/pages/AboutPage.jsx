import { useState } from 'react';
import avatarUrl from '../assets/avatar.png';
import witchInk from '../assets/witch-ink.webp';
import { t, useI18n } from '../i18n';

const CURRENT_VERSION = __APP_VERSION__;
const RELEASE_REPO = 'xiaolu511/cardbox';

// 按段比数字：1.0.10 > 1.0.9（字符串比较会判反），返回 1 / 0 / -1
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 先问本地服务端（它带 10 分钟缓存），失败再直连 GitHub。
// 为什么要两条路：部分机器上 Node 的证书链验不过 GitHub（unable to verify the first certificate），
// 而 Chromium 走 Windows 系统证书库是通的，所以兜底直连反而能成功。
async function fetchLatestRelease(signal) {
  try {
    const res = await fetch('/api/version', { signal });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.latestVersion) return data;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
  const rel = await res.json();
  return {
    latestVersion: String(rel.tag_name || '').replace(/^v/i, ''),
    releaseNotes: rel.body || '',
    downloadUrl: rel.html_url,
  };
}

export default function AboutPage() {
  useI18n();
  const [updateState, setUpdateState] = useState('idle'); // idle | loading | latest | update_available | error
  const [updateInfo, setUpdateInfo] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  const checkUpdate = async () => {
    setUpdateState('loading');
    setErrMsg('');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const data = await fetchLatestRelease(ctrl.signal);
      const latest = String(data.latestVersion || '').replace(/^v/i, '');
      if (!latest) throw new Error(t('版本信息无效'));

      // 只有服务端更新才提示；本地比远端新（比如自己编的 dev 包）就不打扰
      if (compareVersions(latest, CURRENT_VERSION) > 0) {
        setUpdateInfo({ ...data, latestVersion: latest });
        setUpdateState('update_available');
      } else {
        setUpdateState('latest');
      }
    } catch (e) {
      setErrMsg(e.name === 'AbortError' ? t('请求超时') : e.message);
      setUpdateState('error');
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <div className="max-w-3xl mx-auto animate-page">
      <div className="bg-card rounded-2xl shadow-sm border border-app overflow-hidden transition-colors duration-300">
        
        {/* 头部横幅区 */}
        <div className="h-32 bg-primary-600/10 flex items-end justify-center relative overflow-hidden">
          {/* 用 mask 把线稿当遮罩涂成主题色：像素源自 PNG，不会有矢量描摹的断线 */}
          <div
            className="absolute right-0 -bottom-2 h-[112%] aspect-[1400/874] bg-current text-muted opacity-50 pointer-events-none select-none"
            style={{
              WebkitMaskImage: `url(${witchInk})`,
              maskImage: `url(${witchInk})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'bottom right',
              maskPosition: 'bottom right',
              WebkitMaskComposite: 'source-over',
              maskComposite: 'add',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-card"></div>
        </div>

        {/* 软件信息区 */}
        <div className="px-8 pb-8 relative flex flex-col items-center">
          {/* Logo */}
          <div className="w-20 h-20 bg-primary-600 rounded-2xl shadow-lg flex items-center justify-center -mt-10 mb-4 transform hover:scale-105 transition-transform duration-300">
            <span className="text-4xl text-white font-bold">C</span>
          </div>
          
          <h1 className="text-2xl font-bold text-main">Cardbox</h1>
          {/* 🌟 改用常量，如果要用 __APP_VERSION__ 需要去 vite.config.js 配 define */}
          <p className="text-sm text-primary-600 font-medium mt-1">v{CURRENT_VERSION}</p>
          
          <p className="text-muted text-sm mt-3 text-center max-w-md">
            {t('一款基于 AI 的智能知识卡片笔记软件。将长文本一键提炼为问答卡片，结合间隔重复算法，让你的学习效率翻倍。')}
          </p>

          <div className="mt-6 flex gap-3 items-center">
            <a 
              href="https://github.com/xiaolu511/cardbox" 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-app border border-app text-main rounded-lg text-sm font-medium hover-item transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" /></svg>
              {t('GitHub 主页')}
            </a>

            {/* 🌟 检查更新按钮状态机 */}
            {updateState === 'idle' && (
              <button onClick={checkUpdate} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
                {t('检查更新')}
              </button>
            )}
            {updateState === 'loading' && (
              <button disabled className="px-4 py-2 bg-primary-600/50 text-white rounded-lg text-sm font-medium cursor-wait flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                {t('检查中...')}
              </button>
            )}
            {updateState === 'latest' && (
              <button onClick={() => setUpdateState('idle')} className="px-4 py-2 bg-green-500/10 text-green-600 rounded-lg text-sm font-medium hover:bg-green-500/20 transition-colors">
                {t('✨ 已是最新版')}
              </button>
            )}
            {updateState === 'error' && (
              <button onClick={checkUpdate} title={errMsg} className="px-4 py-2 bg-red-500/10 text-red-600 rounded-lg text-sm font-medium hover:bg-red-500/20 transition-colors">
                {t('检查失败，重试')}
              </button>
            )}
          </div>
          
          {/* 发现新版本面板：只用已有映射的 primary-600 档 + 主题 token，
              否则 primary-50/200/700 这些色阶没在 @theme 里，class 会整个不生成（出来是一圈黑边） */}
          {updateState === 'update_available' && updateInfo && (
            <div className="mt-4 w-full p-4 bg-primary-600/10 border border-primary-600/30 rounded-xl animate-page">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-primary-600">{t('发现新版本 v{n}', { n: updateInfo.latestVersion })}</h4>
                <button onClick={() => setUpdateState('idle')} className="text-xs text-primary-600 hover:underline">{t('稍后提醒')}</button>
              </div>
              <pre className="text-xs text-muted whitespace-pre-wrap mb-3">
                {updateInfo.releaseNotes}
              </pre>
              <a 
                href={updateInfo.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block px-4 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm"
              >
                {t('前往下载')}
              </a>
            </div>
          )}
        </div>

        {/* 分割线 */}
        <div className="border-t border-app"></div>

        {/* 详情信息区 */}
        <div className="p-8 space-y-8">
          
          {/* 技术栈 */}
          <div>
            <h3 className="text-sm font-bold text-main mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
              {t('技术栈')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {['React', 'Fastify', 'SQLite (FTS5)', 'TailwindCSS', 'Electron', 'DeepSeek AI', 'Zod'].map(tech => (
                <span key={tech} className="px-3 py-1 bg-app border border-app rounded-md text-xs font-medium text-muted">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* 开发者 */}
          <div>
            <h3 className="text-sm font-bold text-main mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              {t('开发者')}
            </h3>
            <div className="flex items-center gap-4 p-4 bg-app border border-app rounded-xl">
              {/* 🌟 这里使用了本地化导入的头像 */}
              <img 
                src={avatarUrl} 
                alt="xiaolu511" 
                className="w-12 h-12 rounded-full border border-app shadow-sm object-cover bg-white"
              />
              <div>
                <p className="font-bold text-main text-sm">xiaolu511</p>
                <p className="text-xs text-muted mt-0.5">{t('全栈独立开发者')}</p>
                <p className="text-xs text-muted mt-0.5">{t('联系邮箱: {e}', { e: '2902338992@qq.com' })}</p>
              </div>
            </div>
          </div>

          {/* 底部版权 */}
          <div className="pt-4 text-center">
            <p className="text-xs text-muted">
              © {new Date().getFullYear()} Cardbox. Built with ❤️ and AI.
            </p>
            <p className="text-xs text-muted mt-1">
              {t('本软件基于 MIT 协议开源。')}
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}