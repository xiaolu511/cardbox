import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { t, useI18n, getLang } from '../i18n';

// 库里存的是 UTC（'YYYY-MM-DD HH:MM:SS'），直接显示会差 8 小时
const fmtTime = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function NotesPage({ active = true }) {
  useI18n();
  const [text, setText] = useState('');
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  // 拆卡前先问张数；null = 没在选择。ids 可能是一条，也可能是批量选中的多条。
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitCount, setSplitCount] = useState(3);
  // 批量模式
  const [batchMode, setBatchMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // 🌟 分页状态
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // 用 ref 挡并发：state 在同一次渲染里是旧值，两次连点会双发请求
  const busyRef = useRef(false);

  async function load(reset = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setErr('');
    try {
      const currentPage = reset ? 1 : page;
      const res = await api(`/api/notes?page=${currentPage}&limit=15`);

      if (reset) {
        setNotes(res.data);
        setPage(2);
      } else {
        setNotes(prev => [...prev, ...res.data]);
        setPage(prev => prev + 1);
      }
      setHasMore(res.hasMore);
    } catch (e) {
      setErr(e.message);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  // 页面常驻（hidden 切换），所以切回来时要自己重拉一次
  useEffect(() => { if (active) load(true); }, [active]);

  // 退出批量模式就清空选择
  useEffect(() => { if (!batchMode) setSel(new Set()); }, [batchMode]);

  async function add() {
    if (!text.trim()) return;
    setErr('');
    try {
      await api('/api/notes', { method: 'POST', body: { raw_text: text } });
      setText('');
      await load(true); // 保存后重置分页
    } catch (e) { setErr(e.message); }
  }

  async function split(ids, count) {
    setErr('');
    const list = Array.isArray(ids) ? ids : [ids];
    setBusyId(list.length === 1 ? list[0] : 'batch');
    let ok = 0;
    try {
      for (const id of list) {
        try {
          const r = await api(`/api/notes/${id}/cards`, { method: 'POST', body: { lang: getLang(), count } });
          ok += r.created || 0;
        } catch (e) { setErr(e.message); }
      }
      if (ok > 0) alert(t('🎉 成功拆出 {n} 张卡片！', { n: ok }));
    } finally {
      setBusyId(null);
      setSplitTarget(null);
      await load(true);
    }
  }

  async function del(id) {
    if (!confirm(t('⚠️ 确定要删除这条笔记吗？'))) return;
    setErr('');
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      await load(true);
    } catch (e) { setErr(e.message); }
  }

  async function batchDelete() {
    if (sel.size === 0) return;
    if (!confirm(t('⚠️ 确定要删除选中的 {n} 条笔记吗？', { n: sel.size }))) return;
    setBatchBusy(true);
    setErr('');
    try {
      for (const id of [...sel]) {
        try { await api(`/api/notes/${id}`, { method: 'DELETE' }); } catch (e) { setErr(e.message); }
      }
      setBatchMode(false);
      await load(true);
    } finally { setBatchBusy(false); }
  }

  function toggleSel(id) {
    setSel(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder={t('粘贴一段笔记，比如：TCP 三次握手是为了确认双方收发能力都正常……')}
        className="w-full h-32 p-3 border border-app bg-transparent text-main rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-400"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={add} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">{t('保存笔记')}</button>
        {!batchMode ? (
          <button
            onClick={() => setBatchMode(true)}
            className="px-4 py-2 rounded-lg border border-app text-main hover:border-primary-500/60 transition-colors"
          >{t('批量')}</button>
        ) : (
          <>
            <span className="text-sm text-muted">{t('已选 {n} 条', { n: sel.size })}</span>
            <button
              onClick={() => { if (sel.size) { setSplitCount(3); setSplitTarget({ ids: [...sel] }); } }}
              disabled={sel.size === 0 || batchBusy}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-40"
            >{t('批量拆卡')}</button>
            <button
              onClick={batchDelete}
              disabled={sel.size === 0 || batchBusy}
              className="px-4 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
            >{t('批量删除')}</button>
            <button
              onClick={() => setBatchMode(false)}
              className="px-4 py-2 rounded-lg text-muted hover-item transition-colors"
            >{t('退出批量')}</button>
          </>
        )}
        {err && <span className="text-red-500 text-sm">{err}</span>}
      </div>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li
            key={n.id}
            onClick={batchMode ? () => toggleSel(n.id) : undefined}
            className={`border rounded-xl p-4 bg-card transition-colors duration-300 ${batchMode ? 'cursor-pointer' : ''} ${sel.has(n.id) ? 'border-primary-500 bg-primary-600/5' : 'border-app'}`}
          >
            <div className="flex gap-3">
              {batchMode && (
                <input
                  type="checkbox"
                  checked={sel.has(n.id)}
                  onChange={() => toggleSel(n.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 w-4 h-4 accent-[var(--custom-primary)] shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-sm text-main">{n.raw_text}</p>
                <div className="mt-3 flex items-center gap-4 text-xs border-t border-app pt-3">
                  <span className="text-muted">{fmtTime(n.created_at)}</span>
                  <div className="ml-auto flex gap-4">
                    <button onClick={(e) => { e.stopPropagation(); del(n.id); }} className="text-muted hover:text-red-500 transition-colors">{t('删除')}</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSplitCount(3); setSplitTarget({ ids: [n.id] }); }}
                      disabled={busyId === n.id || busyId === 'batch'}
                      className="text-primary-600 font-medium hover:underline disabled:opacity-50"
                    >
                      {busyId === n.id ? t('AI 拆卡中...') : t('✨ 拆成卡片')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {splitTarget && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6">
          <div className="w-full max-w-sm bg-card border border-app rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-app">
              <h3 className="font-bold text-main">
                {splitTarget.ids.length > 1 ? t('批量拆卡') : t('拆成卡片')}
              </h3>
              <p className="text-xs text-muted mt-1 truncate">
                {splitTarget.ids.length > 1
                  ? t('已选 {n} 条', { n: splitTarget.ids.length })
                  : (notes.find(x => x.id === splitTarget.ids[0])?.raw_text || '')}
              </p>
            </div>
            <div className="px-5 py-5 space-y-3">
              <label className="block text-sm font-medium text-main">{t('想要几张卡片？')}</label>
              <div className="flex items-center gap-2 flex-wrap">
                {[3, 5, 8, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSplitCount(n)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${splitCount === n ? 'border-primary-500 bg-primary-600/10 text-primary-600 font-medium' : 'border-app text-muted hover:border-primary-500/50'}`}
                  >{n}</button>
                ))}
                <input
                  type="number" min="1" max="20" value={splitCount}
                  onChange={(e) => setSplitCount(Math.min(Math.max(Number(e.target.value) || 0, 1), 20))}
                  className="w-20 px-3 py-1.5 rounded-lg border border-app bg-app text-center text-sm"
                />
              </div>
              <p className="text-xs text-muted">{t('AI 会尽量按这个数量拆，实际以内容为准。')}</p>
            </div>
            <div className="px-5 py-4 border-t border-app flex justify-end gap-3">
              <button onClick={() => setSplitTarget(null)} className="px-4 py-2 rounded-lg text-muted hover-item transition-colors">{t('取消')}</button>
              <button
                onClick={() => split(splitTarget.ids, splitCount)}
                disabled={busyId !== null}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
              >{busyId !== null ? t('AI 拆卡中...') : t('开始拆卡')}</button>
            </div>
          </div>
        </div>, document.body)}

      {/* 🌟 加载更多按钮 */}
      {hasMore && (
        <div className="text-center pt-4">
          <button
            onClick={() => load(false)}
            disabled={loading}
            className="px-6 py-2 bg-app border border-app text-muted rounded-lg text-sm hover-item transition-colors disabled:opacity-50"
          >
            {loading ? t('加载中...') : t('加载更多')}
          </button>
        </div>
      )}
    </div>
  );
}
