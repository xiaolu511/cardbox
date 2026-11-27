import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { api } from '../api';
import { createPortal } from 'react-dom';
import { useModalPresence } from '../modalAnim';
import AboutPage from './AboutPage';
import { applyTheme, readTheme, saveTheme, getContrastColor, importCustomFont, resetTheme } from '../theme';
import { t, useI18n, setLang, getLang, LANGS } from '../i18n';
import { STRICTNESS_OPTIONS, getStrictness, setStrictness } from '../judgePrefs';
import { useSwitchClass } from '../switchAnim';

const PRESETS = [
  { name: '经典亮色', primary: '#2563eb', bg: '#f8fafc', sidebar: '#ffffff', card: '#ffffff' },
  { name: '葡萄紫', primary: '#9333ea', bg: '#faf5ff', sidebar: '#ffffff', card: '#ffffff' },
  { name: '复古护眼', primary: '#d97706', bg: '#fef3c7', sidebar: '#fffbeb', card: '#ffffff' },
  { name: '暗夜黑', primary: '#3b82f6', bg: '#0f172a', sidebar: '#1e293b', card: '#1e293b' },
  { name: '深空灰', primary: '#6366f1', bg: '#111827', sidebar: '#1f2937', card: '#1f2937' },
];

export default function SettingsPage({ active = true }) {
  useI18n();
  const [sec, setSec] = useState('ai');
  const secCls = useSwitchClass(sec, ['ai', 'personal', 'storage', 'about'], 'y');

  // 换二级菜单时把内容拉回顶部，并保证高度不塌，避免整页跟着跳
  // 用 layout effect：在绘制前回顶，避免先画旧位置再跳一下
  useLayoutEffect(() => {
    if (!active) return;
    const box = document.querySelector('main .overflow-y-auto');
    if (box) box.scrollTop = 0;
  }, [sec, active]);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState({ hasKey: false, maskedKey: '' });
  const [msg, setMsg] = useState('');

  // 清空全部数据（危险操作）
  const [resetOpen, setResetOpen] = useState(false);
  const [resetWord, setResetWord] = useState('');
  const [resetArmed, setResetArmed] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState('');
  const [resetWrong, setResetWrong] = useState(false);
  const resetModal = useModalPresence(resetOpen);
  
  // 主题状态：整份存在一个对象里，改哪个字段都走 update()，保证保存和应用不会漏项
  const [theme, setTheme] = useState(() => readTheme());
  const { primary, bg, sidebar, card, fontSize } = theme;

  const [fontName, setFontName] = useState(theme.fontFamily);
  const [strictness, setStrictnessState] = useState(getStrictness());
  const [fontMsg, setFontMsg] = useState('');
  const [themeMsg, setThemeMsg] = useState('');
  const fileInputRef = useRef(null);

  // 切回设置页时重读一次 key 状态（别的窗口/别的设备改过也能同步）
  useEffect(() => {
    if (!resetOpen) { setResetArmed(false); setResetWord(''); setResetErr(''); return undefined; }
    setResetArmed(false);
    const t = setTimeout(() => setResetArmed(true), 3000);
    return () => clearTimeout(t);
  }, [resetOpen]);

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
      <div className="flex gap-8 items-start">
        <aside className="w-44 shrink-0 space-y-1 hidden md:block sticky top-0 self-start bg-card border border-app rounded-2xl p-3 shadow-sm">
          {[
            { id: 'ai', label: t('AI 设置') },
            { id: 'personal', label: t('个性化设置') },
            { id: 'storage', label: t('存储设置') },
            { id: 'about', label: t('关于') },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSec(o.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${sec === o.id ? 'bg-primary-600/10 text-primary-700 font-medium' : 'text-main hover:bg-app'}`}
            >{o.label}</button>
          ))}
        </aside>
        <div className="flex-1 min-w-0 space-y-6 min-h-[520px] bg-card border border-app rounded-2xl shadow-sm p-5">

      {/* AI 引擎 */}
      <div className={`bg-card rounded-xl shadow-sm border border-app overflow-hidden ${sec === 'ai' ? '' : 'hidden'} ${secCls}`}>
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
      <div className={`bg-card rounded-xl shadow-sm border border-app overflow-hidden ${sec === 'personal' ? '' : 'hidden'} ${secCls}`}>
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
      {/* AI 判定严格度 */}
      <div className={`bg-card rounded-xl shadow-sm border border-app overflow-hidden ${sec === 'ai' ? '' : 'hidden'} ${secCls}`}>
        <div className="px-6 py-4 border-b border-app bg-black/5">
          <h3 className="font-bold text-primary-600">{t('AI 判定严格度')}</h3>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="flex gap-2">
            {STRICTNESS_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => { setStrictness(o.id); setStrictnessState(o.id); }}
                className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${strictness === o.id ? 'border-primary-500 bg-primary-600/10 text-primary-600' : 'border-app text-muted hover:bg-black/5'}`}
              >
                {t(o.label)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t('越严格，答案缺关键点就越容易被判成「忘了」。')}</p>
        </div>
      </div>

      {/* 主题外观 */}
      <div className={`bg-card rounded-xl shadow-sm border border-app overflow-hidden ${sec === 'personal' ? '' : 'hidden'} ${secCls}`}>
        <div className="px-6 py-4 border-b border-app bg-black/5">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-primary-600">{t('主题与外观')}</h3>
            <button
              onClick={() => { resetTheme(); setTheme(readTheme()); setThemeMsg(t('已恢复默认外观')); setTimeout(() => setThemeMsg(''), 2500); }}
              className="ml-auto px-3 py-1 text-xs rounded-lg border border-app text-muted hover:text-main hover:border-primary-500/60 transition-colors"
            >{t('恢复默认')}</button>
            {themeMsg && <span className="text-xs text-green-600">{themeMsg}</span>}
          </div>
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
        <div className={`space-y-6 ${sec === 'storage' ? '' : 'hidden'} ${secCls}`}>
          <div className="bg-card rounded-xl shadow-sm border border-app overflow-hidden">
            <div className="px-6 py-4 border-b border-app bg-black/5">
              <h3 className="font-bold text-primary-600">{t('数据存储')}</h3>
            </div>
            <div className="p-6 space-y-3 text-sm text-main">
              <p>{t('笔记、卡片、复习记录都存在本机一个 SQLite 文件里，不上传任何服务器。')}</p>
              <p className="text-xs text-muted break-all">{status.dbPath || t('读取中…')}</p>
              {window.electronAPI?.chooseDataDir && (
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    onClick={async () => {
                      const dir = await window.electronAPI.chooseDataDir();
                      if (!dir) return;
                      const ok = window.confirm(t('把数据搬到这个位置并重启？数据会复制过去，原目录保留一份备份。') + '\n' + dir);
                      if (!ok) return;
                      const r = await window.electronAPI.setDataDir(dir);
                      if (!r?.ok) setMsg(t('切换失败：{e}', { e: r?.error || 'unknown' }));
                    }}
                    className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700 transition-colors"
                  >
                    {t('更改保存位置…')}
                  </button>
                  <span className="text-xs text-muted">{t('会先复制一份，重启后生效')}</span>
                </div>
              )}
              <p className="text-xs text-muted">{t('API Key、主题、字号这些偏好也只保存在这台电脑上。')}</p>
            </div>
          </div>
          <div className="rounded-xl border-2 border-red-500/40 bg-red-500/5 overflow-hidden">
            <div className="px-6 py-4 border-b border-red-500/30 bg-red-500/10">
              <h3 className="font-bold text-red-600 dark:text-red-400">{t('恢复出厂设置')}</h3>
            </div>
            <div className="p-6 space-y-3 text-sm text-main">
              <p>{t('把卡盒恢复成刚装好时的样子：账号、API Key、主题、字体、语言、判分偏好，以及全部笔记、卡片、待办、重要事项、复习记录，全部删掉。删完会自动重启，需要重新注册。')}</p>
              <button
                type="button"
                onClick={() => { setResetWord(''); setResetErr(''); setResetOpen(true); }}
                className="px-4 py-2 rounded-lg border-2 border-red-500 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-500 hover:text-white transition-colors"
              >
                {t('格式化应用（恢复出厂）…')}
              </button>
            </div>
          </div>
        </div>

        <div className={`${sec === 'about' ? '' : 'hidden'} ${secCls}`}>
          <AboutPage embedded />
        </div>
        </div>
      </div>

      {resetModal.mounted && createPortal(
        <div className={`fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6 modal-overlay danger-overlay ${resetModal.closing ? 'closing' : ''}`}>
          <div className={`w-full max-w-md bg-card rounded-2xl shadow-2xl overflow-hidden modal-panel danger-panel ${resetModal.closing ? 'closing' : ''}`}>
            <div className="px-6 pt-6 pb-4 text-center border-b border-red-500/30 bg-red-500/10 danger-glow">
              <div className="text-4xl mb-2">⚠️</div>
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400">{t('格式化应用')}</h3>
              <p className="mt-2 text-sm text-main">{t('这相当于把软件卸掉重装：账号和所有本地设置都会消失，且不可恢复。')}</p>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted">
                {t('确认请手动输入「格式化」三个字：')}
              </p>
              <input
                autoFocus
                value={resetWord}
                onChange={(e) => { setResetWord(e.target.value); setResetWrong(false); }}
                placeholder={t('格式化')}
                className={`w-full px-3 py-2 rounded-lg border-2 bg-transparent text-main text-center tracking-widest focus:outline-none ${resetWrong ? 'border-red-500 danger-shake' : 'border-app focus:border-red-400'}`}
              />
              {resetErr && <p className="text-sm text-red-500 text-center">{resetErr}</p>}
              <button
                type="button"
                disabled={!resetArmed || resetWord.trim() !== '格式化' || resetBusy}
                onClick={async () => {
                  setResetBusy(true);
                  setResetErr('');
                  try {
                    if (window.electronAPI?.factoryReset) {
                      const r = await window.electronAPI.factoryReset();
                      if (!r?.ok) throw new Error(r?.error || '重置失败');
                      setResetOpen(false);
                    } else {
                      // 浏览器调试环境没有 Electron：清接口 + localStorage 兜底
                      await api('/api/data/reset', { method: 'POST', body: { confirm: '清空' } });
                      localStorage.clear();
                      setResetOpen(false);
                      setTimeout(() => window.location.reload(), 260);
                    }
                  } catch (e) {
                    setResetErr(e.message);
                    setResetWrong(true);
                  } finally {
                    setResetBusy(false);
                  }
                }}
                className={`w-full py-3 rounded-xl text-base font-bold text-white transition-all ${(!resetArmed || resetWord.trim() !== '清空' || resetBusy) ? 'bg-red-900/40 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 danger-breath'}`}
              >
                {resetBusy ? t('正在删除…') : resetArmed ? t('永久删除') : t('请稍等 3 秒…')}
              </button>
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="w-full py-2 text-sm text-muted hover:text-main transition-colors"
              >
                {t('取消')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}