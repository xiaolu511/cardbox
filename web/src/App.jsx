import { useState, useEffect } from 'react';
import { getToken, setToken, setUnauthorizedHandler } from './api';
import { applyTheme, readTheme, ensureCustomFont } from './theme';
import { t, useI18n } from './i18n';
import { checkForUpdateSilently } from './update';
import { emitDropFile } from './dropbus';
import { getFocusMode, subscribeFocusMode } from './focusbus';
import { upload } from './api';
import LoginPage from './pages/LoginPage';
import NotesPage from './pages/NotesPage';
import CardsPage from './pages/CardsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  useI18n(); // 订阅语言变化，切换后整棵树重渲染
  const [token, _setToken] = useState(getToken());
  const [tab, setTab] = useState('notes');
  const [updateReady, setUpdateReady] = useState(null); // { latestVersion } | null
  const [dragging, setDragging] = useState(false);
  const [dropErr, setDropErr] = useState('');
  const [dropBusy, setDropBusy] = useState(false);
  const [focusMode, setFocusMode] = useState(getFocusMode());

  useEffect(() => {
    // 主题与自定义字体都只在启动时初始化一次；设置页改完会直接调 applyTheme 即时生效。
    // 变量清单只维护在 theme.js 一份，别在这儿再抄一遍。
    ensureCustomFont();
    applyTheme(readTheme());
  }, []);

  useEffect(() => {
    // 启动时静默查一次新版本：失败、超时都当没查到，绝不打扰用户
    let alive = true;
    const timer = setTimeout(() => {
      checkForUpdateSilently().then((v) => { if (alive && v) setUpdateReady(v); });
    }, 4000); // 等启动动画和首屏请求先跑完，别抢带宽
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    // token 失效（换过 JWT 密钥、或 7 天到期）时自动回登录页，不再卡在一行红字上
    setUnauthorizedHandler(() => {
      setToken(null);
      _setToken(null);
    });
  }, []);


  useEffect(() => subscribeFocusMode(setFocusMode), []);

  useEffect(() => {
    if (!token) return;
    let depth = 0;
    const isFile = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

    const onEnter = (e) => {
      if (!isFile(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onOver = (e) => {
      if (!isFile(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = () => {
      depth = Math.max(depth - 1, 0);
      if (depth === 0) setDragging(false);
    };
    const onDrop = async (e) => {
      if (!isFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;

      const ok = /\.(txt|md|markdown|docx|pdf)$/i.test(file.name);
      if (!ok) { setDropErr(t('只支持 txt / md / docx / pdf')); setTimeout(() => setDropErr(''), 4000); return; }
      if (file.size > 10 * 1024 * 1024) { setDropErr(t('文件不能超过 10MB')); setTimeout(() => setDropErr(''), 4000); return; }

      setDropBusy(true);
      try {
        const r = await upload('/api/extract', file);
        const data = r?.data ?? r;
        setTab('notes');
        emitDropFile({ name: data.filename || file.name, text: data.text || '' });
      } catch (err) {
        setDropErr(err.message);
        setTimeout(() => setDropErr(''), 5000);
      } finally {
        setDropBusy(false);
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [token]);

  const navItems = [
    { id: 'notes', label: t('笔记'), icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    { id: 'cards', label: t('卡片'), icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { id: 'settings', label: t('设置'), icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-sidebar transition-colors duration-300">
      <header className="relative h-14 flex items-center justify-between px-4 border-b border-app shrink-0 drag-region z-50">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-primary-600 text-white flex items-center justify-center text-xs font-bold">C</span>
          <h1 className="text-lg font-bold text-primary-600">Cardbox</h1>
        </div>
        {token && !focusMode && (
          <nav className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 no-drag">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`relative inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm transition-colors duration-150 ${
                  tab === item.id
                    ? 'tab-active font-semibold'
                    : 'text-muted hover-item font-semibold hover:text-main'
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon} />
                </svg>
                {item.label}
                {item.id === 'settings' && updateReady && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={t('有新版本 v{v}', { v: updateReady.latestVersion })} />
                )}
              </button>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-1 no-drag ml-auto">
          {token && (
            <button onClick={() => { setToken(null); _setToken(null); }} className="mr-1 px-3 py-1.5 text-xs rounded-lg text-muted hover-item hover:text-main transition-colors">{t('退出登录')}</button>
          )}
          <button onClick={() => window.electronAPI?.minimize()} className="p-2 hover-item rounded-md text-muted hover:text-main transition-colors"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor" /></svg></button>
          <button onClick={() => window.electronAPI?.maximize()} className="p-2 hover-item rounded-md text-muted hover:text-main transition-colors"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg></button>
          <button onClick={() => window.electronAPI?.close()} className="p-2 hover:bg-red-500 hover:text-white rounded-md text-muted transition-colors"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg></button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">


        <main className="flex-1 flex flex-col relative overflow-hidden bg-app transition-colors duration-300">
          <div className="flex-1 overflow-y-auto px-6 py-6 z-10 [scrollbar-gutter:stable]">
             {!token ? (
               <div className="h-full flex justify-center items-center pb-20">
                 <LoginPage onLogin={(t) => { setToken(t); _setToken(t); }} />
               </div>
             ) : (
               // 页面常驻（hidden 切换）避免每次切页重挂重拉；但要给页面 active，
               // 让它们在被切回来时自己刷新一次，否则在笔记页拆完卡、切到卡片页看不到新卡
               <>
                 <div className={tab === 'notes' ? 'block animate-page max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto' : 'hidden'}>
                   <NotesPage active={tab === 'notes'} />
                 </div>
                 <div className={tab === 'cards' ? 'block animate-page max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto' : 'hidden'}>
                   <CardsPage active={tab === 'cards'} />
                 </div>
                 <div className={tab === 'settings' ? 'block animate-page max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto' : 'hidden'}>
                   <SettingsPage active={tab === 'settings'} />
                 </div>
               </>
             )}
          </div>
        </main>
      </div>
    </div>
  );
}