import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { applyTheme, readTheme, saveTheme, getContrastColor, importCustomFont } from '../theme';
import { t, useI18n, setLang, getLang, LANGS } from '../i18n';

const PRESETS = [
  { name: '经典亮色', primary: '#2563eb', bg: '#f8fafc', sidebar: '#ffffff', card: '#ffffff' },
  { name: '葡萄紫', primary: '#9333ea', bg: '#faf5ff', sidebar: '#ffffff', card: '#ffffff' },
  { name: '复古护眼', primary: '#d97706', bg: '#fef3c7', sidebar: '#fffbeb', card: '#ffffff' },
  { name: '暗夜黑', primary: '#3b82f6', bg: '#0f172a', sidebar: '#1e293b', card: '#1e293b' },
  { name: '深空灰', primary: '#6366f1', bg: '#111827', sidebar: '#1f2937', card: '#1f2937' },
];

export default function SettingsPage({ active = true }) {
  useI18n();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState({ hasKey: false, maskedKey: '' });
  const [msg, setMsg] = useState('');
  
  // 主题状态：整份存在一个对象里，改哪个字段都走 update()，保证保存和应用不会漏项
  const [theme, setTheme] = useState(() => readTheme());
  const { primary, bg, sidebar, card, fontSize } = theme;

  const [fontName, setFontName] = useState(theme.fontFamily);
  const [fontMsg, setFontMsg] = useState('');
  const fileInputRef = useRef(null);

  // 切回设置页时重读一次 key 状态（别的窗口/别的设备改过也能同步）
  useEffect(() => {
    if (!active) return;
    api('/api/settings').then(setStatus).catch((e) => setMsg(`❌ ${e.message}`));
  }, [active]);

  async function save(e) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/settings', { method: 'POST', body: { api_key: key } });
      setMsg(t('✅ 保存成功！'));
      setKey('');
      const newStatus = await api('/api/settings');
      setStatus(newStatus);
    } catch (e) { setMsg(`❌ ${e.message}`); }
  }

  // 改主题唯一入口：存一份、刷一次；所有 CSS 变量由 theme.js 统一设置，不会漏项
  const update = (patch) => {
    const next = { ...theme, ...patch };
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  const changeFontSize = (e) => update({ fontSize: `${parseInt(e.target.value)}px` });

  const handleFontUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFontMsg(t('❌ 字体文件不能超过 5MB')); return; }
    importCustomFont(file, (r) => {
      if (!r.ok) { setFontMsg(`❌ ${r.error}`); return; }
      const next = { ...readTheme(), fontFamily: r.name };
      setTheme(next);
      saveTheme(next);
      applyTheme(next);
      setFontName(r.name);
      setFontMsg(t('✅ 已应用「{n}」', { n: r.name }));
    });
  };

  return (
    <div className="space-y-6 pb-20">
      <h2 className="text-2xl font-bold text-main mb-6">{t('设置')}</h2>

      {/* AI 引擎 */}
      <div className="bg-card rounded-xl shadow-sm border border-app overflow-hidden">
        <div className="px-6 py-4 border-b border-app bg-black/5">
          <h3 className="font-bold text-primary-600">{t('AI 引擎 (API)')}</h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-main">DeepSeek API Key</p>
              <p className="text-sm text-muted mt-1">{t('状态：')}{status.hasKey ? t('已配置 ({k})', { k: status.maskedKey }) : t('未配置')}</p>
            </div>
            <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-sm text-primary-600 hover:underline">{t('获取 Key')}</a>
          </div>
          <form onSubmit={save} className="flex gap-2">
            <input
              type="password" value={key} onChange={(e) => setKey(e.target.value)}
              placeholder={t('输入 sk- 开头的 Key')}
              className="flex-1 bg-transparent border border-app p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-main placeholder-gray-400"
            />
            <button className="px-6 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium">{t('保存')}</button>
          </form>
          {msg && <p className={`text-sm ${msg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{msg}</p>}
        </div>
      </div>

      {/* 语言 */}
      <div className="bg-card rounded-xl shadow-sm border border-app overflow-hidden">
        <div className="px-6 py-4 border-b border-app bg-black/5">
          <h3 className="font-bold text-primary-600">{t('界面语言')}</h3>
        </div>
        <div className="p-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            {LANGS.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`px-4 py-2 rounded-lg border text-sm transition-colors ${getLang() === l.id ? 'border-primary-500 bg-primary-600/10 text-primary-600 font-medium' : 'border-app text-main hover:bg-black/5'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t('切换后立即生效，保存在本机')}</p>
        </div>
      </div>
      {/* 主题外观 */}
      <div className="bg-card rounded-xl shadow-sm border border-app overflow-hidden">
        <div className="px-6 py-4 border-b border-app bg-black/5">
          <h3 className="font-bold text-primary-600">{t('主题与外观')}</h3>
        </div>
        
        <div className="p-6 space-y-8">
          
          {/* 预设 */}
          <div>
            <p className="text-sm text-main mb-3 font-medium">{t('一键搭配')}</p>
            <div className="flex flex-wrap gap-4">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => update({ primary: p.primary, bg: p.bg, sidebar: p.sidebar, card: p.card })}
                  className={`relative flex flex-col items-center justify-center w-28 h-24 rounded-xl border-2 transition-all overflow-hidden ${
                    primary === p.primary && bg === p.bg ? 'border-primary-500 shadow-md ring-2 ring-primary-200' : 'border-app hover:border-gray-400'
                  }`}
                  style={{ backgroundColor: p.bg }}
                >
                  <div className="absolute top-0 left-0 w-8 h-full border-r" style={{ backgroundColor: p.sidebar, borderColor: 'var(--custom-border)' }} />
                  <div className="w-6 h-6 rounded-full mb-1 ml-6 shadow-sm" style={{ backgroundColor: p.primary }} />
                  <span className="text-[11px] font-medium ml-6 pl-1 pr-1 text-center leading-tight" style={{ color: getContrastColor(p.bg) }}>{t(p.name)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 自定义取色器 */}
          <div className="pt-6 border-t border-app">
            <p className="text-sm text-main mb-3 font-medium">{t('自定义调色板')}</p>
            <div className="grid grid-cols-4 gap-6">
              {[
                { label: '强调色', value: primary, key: 'primary' },
                { label: '主背景', value: bg, key: 'bg' },
                { label: '侧边栏', value: sidebar, key: 'sidebar' },
                { label: '卡片底', value: card, key: 'card' },
              ].map((item) => (
                <div key={item.key} className="flex flex-col items-center gap-2">
                  <label className="text-xs text-muted">{t(item.label)}</label>
                  <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-app shadow-sm cursor-pointer hover:scale-110 transition-transform" style={{ backgroundColor: item.value }}>
                    <input 
                      type="color" 
                      value={item.value} 
                      onChange={(e) => update({ [item.key]: e.target.value })}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 字体大小 */}
          <div className="flex items-center gap-6 pt-6 border-t border-app">
            <p className="w-32 text-sm text-main shrink-0 font-medium">{t('字体大小 ({n})', { n: fontSize })}</p>
            <input 
              type="range" min="12" max="24" step="1"
              value={parseInt(fontSize)} onChange={changeFontSize}
              className="flex-1 max-w-xs accent-primary-600" 
            />
          </div>

          {/* 字体库 */}
          <div className="flex items-center gap-6">
            <p className="w-24 text-sm text-main shrink-0 font-medium">{t('界面字体')}</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-main">{fontName}</span>
              <input type="file" accept=".ttf,.otf,.woff,.woff2" ref={fileInputRef} onChange={handleFontUpload} className="hidden" />
              <button onClick={() => fileInputRef.current.click()} className="px-4 py-1.5 border border-app rounded-lg text-sm text-main hover:bg-black/5 transition-colors">
                {t('导入本地字体')}
              </button>
              {fontMsg && <span className="text-xs text-muted">{fontMsg}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}