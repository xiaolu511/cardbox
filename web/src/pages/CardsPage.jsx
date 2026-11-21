import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { t, useI18n, getLang } from '../i18n';

// 一条笔记的摘要：取原文首行，太长就截断
function summarize(text, max = 90) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export default function CardsPage({ active = true }) {
  useI18n();
  const [q, setQ] = useState('');
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState('');

  // 🌟 分页状态
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  // 🌟 按笔记折叠：默认全收起，搜出结果时全部展开
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  // 批量删除
  const [batchMode, setBatchMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  async function load(keyword = '', reset = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setErr('');
    try {
      const currentPage = reset ? 1 : page;
      const res = await api(`/api/cards?q=${encodeURIComponent(keyword)}&page=${currentPage}&limit=20`);

      if (reset) {
        setCards(res.data);
        setPage(2);
      } else {
        setCards(prev => [...prev, ...res.data]);
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

  useEffect(() => { if (active) load('', true); }, [active]);

  // 按 note_id 分组，保持接口给的顺序（新的在前）
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of cards) {
      if (!map.has(c.note_id)) {
        map.set(c.note_id, { noteId: c.note_id, noteText: c.note_text, cards: [] });
      }
      map.get(c.note_id).cards.push(c);
    }
    return [...map.values()];
  }, [cards]);

  // 搜索时直接展开所有分组，不然点了搜索还得挨个点开
  useEffect(() => {
    if (q.trim()) setExpanded(new Set(groups.map(g => g.noteId)));
  }, [q, groups.length]);

  const toggle = (noteId) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(noteId) ? next.delete(noteId) : next.add(noteId);
      return next;
    });
  };

  async function delCard(id) {
    if (!confirm(t('确定要删除这张卡片吗？'))) return;
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' });
      // 删完重拉第一页：只从本地数组里抠掉一条会让 offset 分页错位，下一页漏一张
      await load(q, true);
    } catch (e) { alert(e.message); }
  }

  async function batchDelete() {
    if (sel.size === 0) return;
    if (!confirm(t('确定要删除选中的 {n} 张卡片吗？', { n: sel.size }))) return;
    setBatchBusy(true);
    try {
      for (const id of [...sel]) {
        try { await api(`/api/cards/${id}`, { method: 'DELETE' }); } catch (e) { alert(e.message); }
      }
      setBatchMode(false);
      await load(q, true);
    } finally { setBatchBusy(false); }
  }

  function toggleSel(id) {
    setSel(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function onUpdated(updated) {
    setCards(prev => prev.map(c => (c.id === updated.id ? { ...c, ...updated } : c)));
  }

  function onSaved(updated) {
    onUpdated(updated);
    setEditing(null);
  }

  return (
    <div className="space-y-6 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <form onSubmit={(e) => { e.preventDefault(); load(q, true); }} className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={t('搜问题或答案（支持全文检索）...')}
          className="flex-1 border border-app bg-transparent text-main p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm placeholder-gray-400"
        />
        <button className="px-5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors text-sm">{t('搜索')}</button>
      </form>

      <div className="flex items-center gap-3 flex-wrap text-sm">
        {!batchMode ? (
          <button
            onClick={() => setBatchMode(true)}
            className="px-4 py-1.5 rounded-lg border border-app text-main hover:border-primary-500/60 transition-colors"
          >{t('批量')}</button>
        ) : (
          <>
            <span className="text-muted">{t('已选 {n} 张', { n: sel.size })}</span>
            <button
              onClick={batchDelete}
              disabled={sel.size === 0 || batchBusy}
              className="px-4 py-1.5 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
            >{t('批量删除')}</button>
            <button
              onClick={() => setBatchMode(false)}
              className="px-4 py-1.5 rounded-lg text-muted hover-item transition-colors"
            >{t('退出批量')}</button>
          </>
        )}
      </div>

      {err && <p className="text-red-500 text-sm">{err}</p>}

      <div className="space-y-3">
        {groups.map((g) => {
          const open = expanded.has(g.noteId);
          return (
            <div key={g.noteId} className="border border-app rounded-xl overflow-hidden bg-card">
              <button
                onClick={() => toggle(g.noteId)}
                className="w-full flex items-start gap-3 p-4 text-left hover:bg-black/[0.03] transition-colors"
                aria-expanded={open}
              >
                <svg
                  className={`w-4 h-4 mt-1 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
                <span className="flex-1 text-sm text-main leading-relaxed line-clamp-2">{summarize(g.noteText)}</span>
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 font-medium">
                  {t('{n} 张卡片', { n: g.cards.length })}
                </span>
              </button>

              {open && (
                <div className="px-4 pb-4 pt-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {g.cards.map((c) => (
                    <div key={c.id} className="border border-app rounded-xl p-5 space-y-3 bg-card group hover:shadow-md transition-all flex flex-col h-full relative">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                          {batchMode && (
                            <input
                              type="checkbox"
                              checked={sel.has(c.id)}
                              onChange={() => toggleSel(c.id)}
                              className="mt-1 w-4 h-4 accent-[var(--custom-primary)] shrink-0"
                            />
                          )}
                          <h3 className="font-bold text-main text-base leading-snug">{c.question}</h3>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => delCard(c.id)} className="p-1.5 rounded-lg text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100" title={t('删除卡片')}>✕</button>
                          <button
                            onClick={() => setEditing(c)}
                            title={t('修改卡片')}
                            className="p-1.5 rounded-lg text-muted hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897l12.682-12.68z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-muted whitespace-pre-wrap flex-1">{c.answer}</p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {(() => {
                          try { return JSON.parse(c.tags).map(tag => <span key={tag} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-md font-medium">{tag}</span>); }
                          catch { return null; }
                        })()}
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cards.length === 0 && !err && (
        <div className="h-[calc(100vh-300px)] flex flex-col items-center justify-center text-muted animate-page">
          <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          <p className="text-lg font-medium">{q ? t('没有搜到相关卡片') : t('还没有卡片，去「笔记」页拆几张吧')}</p>
        </div>
      )}

      {/* 🌟 加载更多按钮 */}
      {hasMore && cards.length > 0 && (
        <div className="text-center pt-4">
          <button
            onClick={() => load(q, false)}
            disabled={loading}
            className="px-6 py-2 bg-app border border-app text-muted rounded-lg text-sm hover-item transition-colors disabled:opacity-50"
          >
            {loading ? t('加载中...') : t('加载更多')}
          </button>
        </div>
      )}

      {editing && createPortal(
        <EditCardModal card={editing} onClose={() => setEditing(null)} onSaved={onSaved} onUpdated={onUpdated} />,
        document.body
      )}
    </div>
  );
}

function EditCardModal({ card, onClose, onSaved, onUpdated }) {
  const [question, setQuestion] = useState(card.question);
  const [answer, setAnswer] = useState(card.answer);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    if (!question.trim()) { setErr(t('问题不能为空')); return; }
    if (!answer.trim()) { setErr(t('答案不能为空')); return; }
    setBusy('save');
    setErr('');
    try {
      const r = await api(`/api/cards/${card.id}`, { method: 'PATCH', body: { question, answer } });
      onSaved(r.data);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  async function regen() {
    if (!question.trim()) { setErr(t('问题不能为空')); return; }
    setBusy('regen');
    setErr('');
    try {
      const r = await api(`/api/cards/${card.id}/regen`, { method: 'POST', body: { question, lang: getLang() } });
      setAnswer(r.data.answer);
      // 重答只在弹窗里预览，不关窗；用户确认后点「保存」再落一次
      onUpdated(r.data);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[80vh] bg-card border border-app rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-5 border-b border-app">
          <div>
            <h3 className="font-bold text-main">{t('修改卡片')}</h3>
            <p className="text-xs text-muted mt-1 line-clamp-2">{summarize(card.note_text, 60)}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-main transition-colors shrink-0">✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <label className="block">
            <span className="text-xs font-medium text-muted">{t('问题')}</span>
            <textarea
              value={question} onChange={(e) => setQuestion(e.target.value)} rows={2}
              className="mt-1 w-full border border-app bg-transparent text-main p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">{t('答案')}</span>
            <textarea
              value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5}
              className="mt-1 w-full border border-app bg-transparent text-main p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </label>
          {err && <p className="text-red-500 text-sm">{err}</p>}
        </div>

        <div className="flex items-center gap-2 p-4 border-t border-app">
          <button
            onClick={regen}
            disabled={!!busy}
            className="px-3 py-2 text-sm rounded-lg border border-app text-main hover:border-primary-500 transition-colors disabled:opacity-50"
          >
            {busy === 'regen' ? t('AI 重答中...') : t('让 AI 重答')}
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm rounded-lg text-muted hover:text-main transition-colors">{t('取消')}</button>
            <button
              onClick={save}
              disabled={!!busy}
              className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {busy === 'save' ? t('保存中...') : t('保存')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
