import { useState, useEffect } from 'react';
import { getToken, setToken } from './api';
import LoginPage from './pages/LoginPage';
import NotesPage from './pages/NotesPage';
import CardsPage from './pages/CardsPage';
import ReviewPage from './pages/ReviewPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [token, _setToken] = useState(getToken());
  const [tab, setTab] = useState('notes');

  // 初始化主题
  useEffect(() => {
    const savedTheme = localStorage.getItem('cardbox-theme') || 'blue';
    if (savedTheme !== 'blue') {
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col h-screen overflow-hidden">
      {/* 🌟 沉浸式拖拽顶栏（现在全局显示，包括登录页） */}
      <header className="drag-region flex items-center gap-6 px-6 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <h1 className="text-xl font-bold text-primary-600 flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-primary-600 text-white flex items-center justify-center text-xs">C</span>
          Cardbox
        </h1>
        
        {/* 只有在登录状态下，才显示中间的导航栏 */}
        {token && (
          <div className="flex gap-2 text-sm no-drag">
            {['notes', 'cards', 'review', 'settings'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  tab === t 
                    ? 'bg-primary-50 text-primary-700 font-medium' 
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                {t === 'notes' ? '笔记' : t === 'cards' ? '卡片' : t === 'review' ? '复习' : '设置'}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-4 no-drag">
          {/* 只有在登录状态下，才显示登出按钮 */}
          {token && (
            <button 
              onClick={() => { setToken(null); _setToken(null); }} 
              className="text-sm text-gray-500 hover:text-red-500 transition-colors"
            >
              登出
            </button>
          )}
          
          {/* 🌟 窗口控制按钮（全局显示） */}
          <div className="flex items-center gap-1 border-l pl-4 border-gray-200">
            <button onClick={() => window.electronAPI?.minimize()} className="p-2 hover:bg-gray-100 rounded text-gray-400">
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" fill="currentColor" /></svg>
            </button>
            <button onClick={() => window.electronAPI?.maximize()} className="p-2 hover:bg-gray-100 rounded text-gray-400">
              <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
            </button>
            <button onClick={() => window.electronAPI?.close()} className="p-2 hover:bg-red-500 hover:text-white rounded text-gray-400 transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* 页面主体内容 */}
      <main className="flex-1 overflow-auto flex flex-col">
        {!token ? (
          // 未登录状态，居中显示登录框
          <div className="flex-1 flex flex-col justify-center pb-20">
            <LoginPage onLogin={(t) => { setToken(t); _setToken(t); }} />
          </div>
        ) : (
          // 已登录状态，显示各个功能页面
          <div className="p-4 md:p-8 w-full max-w-3xl mx-auto">
            {tab === 'notes' && <NotesPage />}
            {tab === 'cards' && <CardsPage />}
            {tab === 'review' && <ReviewPage />}
            {tab === 'settings' && <SettingsPage />}
          </div>
        )}
      </main>
    </div>
  );
}