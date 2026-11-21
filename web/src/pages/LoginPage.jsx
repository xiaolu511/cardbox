import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';

export default function LoginPage({ onLogin }) {
  useI18n();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('cardbox_login_history');
      if (saved) setHistory(JSON.parse(saved));
    } catch (e) {
      console.error('读取历史记录失败', e);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowHistory(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function submit(e) {
    if (e) e.preventDefault();
    setErr('');
    try {
      const { token } = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: { email, password },
      });
      saveToHistory(email, password);
      onLogin(token);
    } catch (e) {
      setErr(e.message);
    }
  }

  const saveToHistory = (mail, pwd) => {
    try {
      let newHistory = history.filter(item => item.email !== mail);
      newHistory.unshift({ email: mail, password: pwd });
      newHistory = newHistory.slice(0, 5);
      setHistory(newHistory);
      localStorage.setItem('cardbox_login_history', JSON.stringify(newHistory));
    } catch (e) {
      console.error('保存历史记录失败', e);
    }
  };

  const selectHistory = (item) => {
    setEmail(item.email);
    setPassword(item.password);
    setShowHistory(false);
    setMode('login');
  };

  return (
    <div className="max-w-sm w-full mx-auto p-8 border border-app rounded-2xl shadow-xl space-y-6 bg-card relative transition-colors duration-300">
      <h1 className="text-2xl font-bold text-primary-600 text-center">Cardbox</h1>
      <p className="text-sm text-muted text-center">{mode === 'login' ? t('欢迎回来，请登录') : t('创建一个新账号')}</p>
      
      <form onSubmit={submit} className="space-y-4">
        
        <div className="relative" ref={dropdownRef}>
          <input 
            type="email" 
            required 
            placeholder={t('邮箱')} 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            onFocus={() => { if (history.length > 0) setShowHistory(true); }}
            className="w-full border border-app bg-transparent text-main p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm placeholder-gray-400" 
          />

          {showHistory && history.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-app rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto overflow-hidden">
              <div className="px-4 py-2 text-xs text-muted bg-black/5 border-b border-app">{t('最近使用的账号')}</div>
              {history.map((item, idx) => (
                <div 
                  key={idx}
                  onClick={() => selectHistory(item)}
                  className="px-4 py-3 hover-item cursor-pointer flex justify-between items-center text-sm border-b border-app last:border-b-0"
                >
                  <span className="text-main">{item.email}</span>
                  <span className="text-muted text-xs">••••••</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <input 
          type="password" 
          required 
          minLength={6} 
          placeholder={t('密码（≥6 位）')} 
          value={password} 
          onChange={(e) => setPassword(e.target.value)} 
          className="w-full border border-app bg-transparent text-main p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm placeholder-gray-400" 
        />
        
        {err && <p className="text-red-500 text-sm text-center">{err}</p>}
        
        <button className="w-full bg-primary-600 text-white py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium text-sm shadow-md">
          {mode === 'login' ? t('登 录') : t('注 册')}
        </button>
      </form>
      
      <div className="flex justify-between items-center pt-2">
        <button 
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setShowHistory(false); }} 
          className="text-sm text-primary-600 hover:underline font-medium"
        >
          {mode === 'login' ? t('没有账号？去注册') : t('已有账号？去登录')}
        </button>

        {mode === 'login' && history.length > 0 && (
          <button 
            onClick={() => {
              localStorage.removeItem('cardbox_login_history');
              setHistory([]);
            }}
            className="text-xs text-muted hover:text-red-500 transition-colors"
          >
            {t('清除记忆')}
          </button>
        )}
      </div>
    </div>
  );
}