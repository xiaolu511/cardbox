import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import ReviewPage from './ReviewPage';
import { t, useI18n, getLang } from '../i18n';

// 一条笔记的摘要：取原文首行，太长就截断
function summarize(text, max = 90) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

// 库里存的是 UTC，直接显示会差 8 小时
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseTags(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function CardsPage({ active = true }) {
  useI18n();
  const [cats, setCats] = useState([]);
  const [catErr, setCatErr] = useState('');
  const [activeCat, setActiveCat] = useState(null); // null = 分类列表；{id,name} = 进入某个分类
  const [tab, setTab] = useState('cards');

  // 全部视图（保留搜索、批量、分页）
  const [q, setQ] = useState('');
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [batchMode, setBatchMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [selTodos, setSelTodos] = useState(() => new Set());
  const [selImportant, setSelImportant] = useState(() => new Set());
  const busyRef = useRef(false);

  // 分类详情（知识点 / 待办 / 重要事项）
  const [overview, setOverview] = useState({ cards: [], todos: [], important: [] });
  const [view, setView] = useState('cards'); // cards | review

  // 新建分类 / 管理分类里的笔记
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [manageCat, setManageCat] = useState(null);
  const [manageQ, setManageQ] = useState('');
  const [managePool, setManagePool] = useState([]);
  const [manageOwn, setManageOwn] = useState([]);
  const [manageSel, setManageSel] = useState(() => new Set());
  const [manageBusy, setManageBusy] = useState(false);

  async function loadCats() {
    try {
      const rows = await api('/api/categories');
      setCats(Array.isArray(rows) ? rows : []);
    } catch (e) { setCatErr(e.message); }
  }

  async function loadOverview(catId) {
    try {
      const r = await api('/api/categories/' + catId + '/overview');
      setOverview({ cards: r.cards || [], todos: r.todos || [], important: r.important || [], notes: r.notes || [] });
    } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    if (!active) return;
    if (activeCat) loadOverview(activeCat.id);
    else loadCats();
  }, [active, activeCat]);

  async function createCategory() {
    const name = newCatName.trim();
    if (!name) { setCatErr(t('请填写分类名称')); return; }
    setCatBusy(true);
    try {
      await api('/api/categories', { method: 'POST', body: { name } });
      setNewCatOpen(false);
      setNewCatName('');
      setCatErr('');
      await loadCats();
    } catch (e) { setCatErr(e.message); } finally { setCatBusy(false); }
  }

  async function loadManage(cat, keyword = '') {
    setManageBusy(true);
    try {
      const [pool, own] = await Promise.all([
        api('/api/notes?limit=100&excludeCategoryId=' + cat.id + '&q=' + encodeURIComponent(keyword)),
        api('/api/notes?limit=100&categoryId=' + cat.id),
      ]);
      setManagePool(pool.data || []);
      setManageOwn(own.data || []);
      setManageSel(new Set());
    } catch (e) { setCatErr(e.message); } finally { setManageBusy(false); }
  }

  function openManage(cat) {
    setManageCat(cat);
    setManageQ('');
    loadManage(cat, '');
  }

  async function addToCategory() {
    if (!manageCat || manageSel.size === 0) return;
    setManageBusy(true);
    try {
      for (const id of manageSel) {
        await api('/api/notes/' + id + '/category', { method: 'PATCH', body: { categoryId: manageCat.id } });
      }
      await loadManage(manageCat, manageQ);
      await loadCats();
    } catch (e) { setCatErr(e.message); } finally { setManageBusy(false); }
  }

  async function moveOut(id) {
    setManageBusy(true);
    try {
      await api('/api/notes/' + id + '/category', { method: 'PATCH', body: { categoryId: null } });
      await loadManage(manageCat, manageQ);
      await loadCats();
    } catch (e) { setCatErr(e.message); } finally { setManageBusy(false); }
  }

  async function deleteNote(id) {
    if (!confirm(t('⚠️ 确定删除这条笔记吗？它的卡片和待办也会一起删除。'))) return;
    setManageBusy(true);
    try {
      await api('/api/notes/' + id, { method: 'DELETE' });
      await loadManage(manageCat, manageQ);
      await loadCats();
    } catch (e) { setCatErr(e.message); } finally { setManageBusy(false); }
  }

  async function load(query = '', reset = true) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setErr('');
    try {
      const p = reset ? 1 : page + 1;
      const r = await api(`/api/cards?q=${encodeURIComponent(query)}&page=${p}`);
      const list = Array.isArray(r) ? r : (r.data || []);
      setCards(reset ? list : [...cards, ...list]);
      setHasMore(Boolean(r.hasMore));
      setPage(p);
      if (reset) { setSel(new Set()); setBatchMode(false); }
    } catch (e) { setErr(e.message); } finally { setLoading(false); busyRef.current = false; }
  }

  useEffect(() => {
    if (!active || !activeCat || activeCat.id !== 'all') return;
    if (tab !== 'cards') return;
    load('', true);
  }, [active, activeCat, tab]);

  async function toggleTodo(item) {
    const next = item.status === 'done' ? 'open' : 'done';
    setOverview((o) => ({ ...o, todos: o.todos.map((x) => (x.id === item.id ? { ...x, status: next } : x)) }));
    try { await api('/api/todos/' + item.id, { method: 'PATCH', body: { status: next } }); }
    catch { loadOverview(activeCat.id); }
  }

  function toggle(noteId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  }

  // 知识点：全部用分页接口，分类内用 overview
  const groups = useMemo(() => {
    const source = activeCat && activeCat.id === 'all' ? cards : overview.cards;
    const map = new Map();
    for (const c of source) {
      const key = c.note_id;
      if (!map.has(key)) map.set(key, { noteId: key, noteText: c.raw_text || c.note_text || '', cards: [] });
      map.get(key).cards.push(c);
    }
    return [...map.values()];
  }, [cards, overview.cards, activeCat]);

  const allCardIds = groups.flatMap((g) => g.cards.map((c) => c.id));
  const allSelected = allCardIds.length > 0 && sel.size === allCardIds.length;

  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(allCardIds));
  }

  function toggleGroup(g) {
    setSel((prev) => {
      const next = new Set(prev);
      const ids = g.cards.map((c) => c.id);
      const all = ids.every((id) => next.has(id));
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function toggleSet(setter, id) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function batchDeleteMisc() {
    const n = selTodos.size + selImportant.size;
    if (!n) return;
    if (!window.confirm(t('确定要删除选中的 {n} 项吗？', { n }))) return;
    setBatchBusy(true);
    try {
      for (const id of selTodos) await api('/api/todos/' + id, { method: 'DELETE' });
      for (const id of selImportant) await api('/api/important/' + id, { method: 'DELETE' });
      setSelTodos(new Set());
      setSelImportant(new Set());
      setBatchMode(false);
      if (activeCat && activeCat.id !== 'all') await loadOverview(activeCat.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBatchBusy(false);
    }
  }

  async function batchDelete() {
    if (sel.size === 0) return;
    if (!confirm(t('确定要删除选中的 {n} 张卡片吗？', { n: sel.size }))) return;
    setBatchBusy(true);
    setErr('');
    try {
      for (const id of sel) await api(`/api/cards/${id}`, { method: 'DELETE' });
      setSel(new Set());
      setBatchMode(false);
      if (activeCat && activeCat.id !== 'all') await loadOverview(activeCat.id);
      else await load(q, true);
    } catch (e) { setErr(e.message); } finally { setBatchBusy(false); }
  }

  function onSaved(updated) {
    setEditing(null);
    setCards((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    setOverview((o) => ({ ...o, cards: o.cards.map((c) => (c.id === updated.id ? updated : c)) }));
  }
  function onUpdated(updated) {
    setCards((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    setOverview((o) => ({ ...o, cards: o.cards.map((c) => (c.id === updated.id ? updated : c)) }));
  }

  // 页内两个视图：卡片 / 复习
  const viewSwitch = (
    <div className="flex gap-1 p-1 rounded-xl bg-app border border-app w-fit">
      {[
        { key: 'cards', label: t('卡片') },
        { key: 'review', label: t('复习') },
      ].map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setView(o.key)}
          className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${view === o.key ? 'bg-card text-main font-medium shadow-sm' : 'text-muted hover:text-main'}`}
        >{o.label}</button>
      ))}
    </div>
  );

  if (view === 'review') {
    return (
      <div className="space-y-4 animate-detail">
        {viewSwitch}
        <ReviewPage active={active} />
      </div>
    );
  }

  // ================= 分类列表 =================
  if (!activeCat) {
    const total = cats.reduce((n, c) => n + (c.cardCount || 0), 0);
    return (
      <div className="space-y-6 animate-list">
        {viewSwitch}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-main">{t('分类')}</h2>
          <button
            type="button"
            onClick={() => { setNewCatName(''); setNewCatOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            {t('新建分类')}
          </button>
        </div>
        {catErr && !newCatOpen && !manageCat && <p className="text-red-500 text-sm">{catErr}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => { setActiveCat({ id: 'all', name: t('全部') }); setTab('cards'); }}
            className="text-left p-5 rounded-2xl border border-app bg-card hover:border-primary-500/50 transition-colors"
          >
            <p className="text-sm font-medium text-main">{t('全部')}</p>
            <p className="text-xs text-muted mt-1">{t('{n} 张卡片', { n: total })}</p>
          </button>
          {cats.map((c) => (
            <div key={c.id} className="relative group">
            <button
              type="button"
              onClick={() => { setActiveCat({ id: c.id, name: c.name }); setTab('cards'); }}
              className="w-full text-left p-5 rounded-2xl border border-app bg-card hover:border-primary-500/50 transition-colors"
            >
              <p className="text-sm font-medium text-main truncate">{c.name}</p>
              <p className="text-xs text-muted mt-1">
                {t('{n} 张卡片', { n: c.cardCount || 0 })}
                {c.todoCount ? ` · ${t('{n} 条待办', { n: c.todoCount })}` : ''}
                {c.importantCount ? ` · ${t('{n} 条重要', { n: c.importantCount })}` : ''}
              </p>
            </button>
            <button
              type="button"
              title={t('管理笔记')}
              onClick={(e) => { e.stopPropagation(); openManage(c); }}
              className="absolute top-3 right-10 p-1.5 rounded-md text-muted opacity-40 hover:opacity-100 hover:text-primary-600 hover:bg-primary-50 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
            </button>
            <button
              type="button"
              title={t('删除分类')}
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm(t('⚠️ 确定删除分类「{name}」吗？里面的内容会回到「全部」，不会被删除。', { name: c.name }))) return;
                try {
                  await api('/api/categories/' + c.id, { method: 'DELETE' });
                  await loadCats();
                } catch (err) { setCatErr(err.message); }
              }}
              className="absolute top-3 right-3 p-1.5 rounded-md text-muted opacity-40 hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-7H4m5-8V3a1 1 0 011-1h4a1 1 0 011 1v2m-6 0h6" /></svg>
            </button>
            </div>
          ))}
        </div>
        {cats.length === 0 && !catErr && (
          <div className="py-16 text-center text-muted text-sm">{t('还没有分类，点右上角「新建分类」可以手动建一个。')}</div>
        )}

        {newCatOpen && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6">
            <div className="w-full max-w-sm bg-card border border-app rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 pt-5 pb-3">
                <h3 className="font-semibold text-main">{t('新建分类')}</h3>
              </div>
              <div className="px-5 pb-4">
                <input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); }}
                  placeholder={t('例如：考研英语')}
                  className="w-full border border-app bg-transparent text-main p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                />
                {catErr && <p className="mt-2 text-sm text-red-500">{catErr}</p>}
              </div>
              <div className="px-5 py-3 flex justify-end gap-2 border-t border-app">
                <button type="button" onClick={() => setNewCatOpen(false)} className="px-4 py-1.5 text-sm text-muted hover:text-main">{t('取消')}</button>
                <button type="button" disabled={catBusy} onClick={createCategory} className="px-4 py-1.5 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                  {catBusy ? t('保存中...') : t('创建')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {manageCat && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6">
            <div className="w-full max-w-2xl max-h-[80vh] bg-card border border-app rounded-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="px-5 py-4 border-b border-app flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-main">{t('管理「{name}」里的笔记', { name: manageCat.name })}</h3>
                  <p className="text-xs text-muted mt-1">{t('把笔记加进来，或从分类里移出、删除。')}</p>
                </div>
                <button type="button" onClick={() => setManageCat(null)} className="text-muted hover:text-main">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {catErr && <p className="text-sm text-red-500">{catErr}</p>}
                <section className="space-y-2">
                  <h4 className="text-sm font-medium text-main">{t('本分类已有 {n} 条', { n: manageOwn.length })}</h4>
                  {manageOwn.length === 0 && <p className="text-sm text-muted">{t('这个分类里还没有笔记')}</p>}
                  {manageOwn.map((n) => (
                    <div key={n.id} className="flex items-start gap-3 border border-app rounded-xl p-3">
                      <p className="flex-1 text-sm text-main leading-relaxed line-clamp-2">{summarize(n.raw_text)}</p>
                      <button type="button" disabled={manageBusy} onClick={() => moveOut(n.id)} className="text-xs text-muted hover:text-main shrink-0">{t('移出')}</button>
                      <button type="button" disabled={manageBusy} onClick={() => deleteNote(n.id)} className="text-xs text-red-500 hover:text-red-600 shrink-0">{t('删除')}</button>
                    </div>
                  ))}
                </section>

                <section className="space-y-2">
                  <h4 className="text-sm font-medium text-main">{t('添加笔记到这个分类')}</h4>
                  <form onSubmit={(e) => { e.preventDefault(); loadManage(manageCat, manageQ); }} className="flex gap-2">
                    <input
                      value={manageQ}
                      onChange={(e) => setManageQ(e.target.value)}
                      placeholder={t('搜索笔记内容...')}
                      className="flex-1 border border-app bg-transparent text-main p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                    <button className="px-4 bg-app border border-app text-main rounded-lg text-sm hover-item">{t('搜索')}</button>
                  </form>
                  {managePool.length === 0 && <p className="text-sm text-muted">{t('没有可添加的笔记')}</p>}
                  <div className="space-y-1.5">
                    {managePool.map((n) => {
                      const checked = manageSel.has(n.id);
                      return (
                        <label key={n.id} className="flex items-start gap-3 border border-app rounded-xl p-3 cursor-pointer hover:border-primary-500/50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setManageSel((prev) => {
                                const next = new Set(prev);
                                if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                                return next;
                              });
                            }}
                            className="mt-1 w-4 h-4 accent-primary-600"
                          />
                          <span className="flex-1 text-sm text-main leading-relaxed line-clamp-2">{summarize(n.raw_text)}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              </div>

              <div className="px-5 py-3 border-t border-app flex items-center justify-between">
                <span className="text-xs text-muted">{t('已选 {n} 条', { n: manageSel.size })}</span>
                <button
                  type="button"
                  disabled={manageBusy || manageSel.size === 0}
                  onClick={addToCategory}
                  className="px-4 py-1.5 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
                >
                  {manageBusy ? t('处理中...') : t('加入本分类')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  const isAll = activeCat.id === 'all';
  const todos = overview.todos;
  const important = overview.important;

  // ================= 分类详情 =================
  return (
    <div className="space-y-4 animate-detail">
      {viewSwitch}
      <div className="flex gap-6 items-start">
        <aside className="w-52 shrink-0 space-y-1 hidden md:block">
          <button
            type="button"
            onClick={() => { setActiveCat({ id: 'all', name: t('全部') }); setTab('cards'); }}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${activeCat.id === 'all' ? 'bg-primary-600/10 text-primary-700 font-medium' : 'text-main hover:bg-app'}`}
          >{t('全部')}</button>
          {cats.map((c) => (
            <div key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => { setActiveCat({ id: c.id, name: c.name }); setTab('cards'); }}
                className={`w-full text-left pl-3 pr-16 py-2 rounded-lg text-sm truncate transition-colors ${activeCat.id === c.id ? 'bg-primary-600/10 text-primary-700 font-medium' : 'text-main hover:bg-app'}`}
              >{c.name}</button>
              <span className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  title={t('管理笔记')}
                  onClick={() => { setActiveCat(null); openManage(c); }}
                  className="p-1 rounded text-muted hover:text-primary-600 hover:bg-primary-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </button>
                <button
                  type="button"
                  title={t('删除分类')}
                  onClick={async () => {
                    if (!confirm(t('⚠️ 确定删除分类「{name}」吗？里面的内容会回到「全部」，不会被删除。', { name: c.name }))) return;
                    try {
                      await api('/api/categories/' + c.id, { method: 'DELETE' });
                      await loadCats();
                      setActiveCat({ id: 'all', name: t('全部') });
                    } catch (err) { setCatErr(err.message); }
                  }}
                  className="p-1 rounded text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-7H4m5-8V3a1 1 0 011-1h4a1 1 0 011 1v2m-6 0h6" /></svg>
                </button>
              </span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setActiveCat(null); setNewCatName(''); setNewCatOpen(true); }}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-muted border border-dashed border-app hover:text-primary-600 hover:border-primary-500/50 transition-colors"
          >+ {t('新建分类')}</button>
        </aside>
        <div className="flex-1 min-w-0 space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setActiveCat(null); setTab('cards'); }}
          className="text-muted hover:text-main transition-colors text-sm inline-flex items-center gap-1"
        >
          ← {t('全部分类')}
        </button>
        <h2 className="font-bold text-main">{activeCat.name}</h2>
      </div>

      <div className="space-y-6 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'cards', label: t('知识点'), n: overview.cards.length },
          { key: 'todos', label: t('待办事项'), n: overview.todos.length },
          { key: 'important', label: t('重要事项'), n: overview.important.length },
          { key: 'notes', label: t('笔记'), n: (overview.notes || []).length },
        ].map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setTab(o.key)}
            className={`text-left p-3 rounded-xl border transition-colors ${tab === o.key ? 'border-primary-500 bg-primary-600/5' : 'border-app hover:border-primary-500/40'}`}
          >
            <div className="text-xs text-muted">{o.label}</div>
            <div className="mt-1 text-2xl font-semibold text-main">{o.n}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-app border border-app w-fit">
        {[
          { key: 'cards', label: t('知识点') },
          { key: 'todos', label: t('待办事项') },
          { key: 'important', label: t('重要事项') },
          { key: 'notes', label: t('笔记') },
        ].map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setTab(o.key)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === o.key ? 'bg-card text-main font-medium shadow-sm' : 'text-muted hover:text-main'}`}
          >{o.label}</button>
        ))}
      </div>

      {tab === 'cards' && (<>
        {isAll && (
          <form onSubmit={(e) => { e.preventDefault(); load(q, true); }} className="flex gap-2">
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('搜问题或答案（支持全文检索）...')}
              className="flex-1 border border-app bg-transparent text-main p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm placeholder-gray-400"
            />
            <button className="px-5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors text-sm">{t('搜索')}</button>
          </form>
        )}

        {err && <p className="text-red-500 text-sm">{err}</p>}

        <div className="space-y-3">
          {groups.map((g) => {
            const open = expanded.has(g.noteId);
            return (
              <div key={g.noteId} className="border border-app rounded-xl overflow-hidden bg-card">
                <div className="w-full flex items-start gap-3 p-4 hover:bg-black/[0.03] transition-colors">
                  <button
                    onClick={() => toggle(g.noteId)}
                    className="flex-1 flex items-start gap-3 text-left"
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
                </div>

                {open && (
                  <div className="px-4 pb-4 pt-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {g.cards.map((c) => (
                      <div key={c.id} className="border border-app rounded-xl p-5 space-y-3 bg-card group hover:shadow-md transition-all flex flex-col h-full relative">
                        <div className="flex items-start gap-2">
                          <p className="flex-1 font-semibold text-main leading-snug pr-8">{c.question}</p>
                          <button
                            onClick={() => setEditing(c)}
                            title={t('修改卡片')}
                            className="absolute top-3 right-3 p-1.5 rounded-md text-muted opacity-70 hover:opacity-100 hover:text-primary-600 hover:bg-primary-50 transition-all"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3.414a2 2 0 01.586-1.414z" />
                            </svg>
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(t('⚠️ 确定要删除这张卡片吗？'))) return;
                              try {
                                await api(`/api/cards/${c.id}`, { method: 'DELETE' });
                                if (isAll) await load(q, true); else await loadOverview(activeCat.id);
                              } catch (e) { setErr(e.message); }
                            }}
                            title={t('删除这张卡片')}
                            className="absolute top-3 right-10 p-1.5 rounded-md text-muted opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        <p className="text-sm text-muted whitespace-pre-wrap leading-relaxed">{c.answer}</p>
                        {(() => {
                          const tags = parseTags(c.tags);
                          if (!tags.length) return null;
                          return (
                            <div className="flex flex-wrap gap-1.5">
                              {tags.map((tag, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 rounded-md bg-app text-muted">{tag}</span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {groups.length === 0 && !err && (
          <div className="h-[calc(100vh-320px)] flex flex-col items-center justify-center text-muted animate-page">
            <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <p className="text-lg font-medium">{q && isAll ? t('没有搜到相关卡片') : t('这个分类下还没有卡片')}</p>
          </div>
        )}

        {isAll && hasMore && groups.length > 0 && (
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
      </>)}

      {tab === 'notes' && (
        <div className="space-y-3">
          {(overview.notes || []).length === 0 && (
            <p className="text-sm text-muted py-6 text-center">{t('这个分类里还没有笔记')}</p>
          )}
          {(overview.notes || []).map((n) => (
            <div key={n.id} className="border border-app rounded-xl p-4 bg-app/40">
              <p className="text-sm text-main whitespace-pre-wrap break-words">{n.raw_text}</p>
              <p className="mt-2 text-xs text-muted">{fmtTime(n.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'todos' && (
        <div className="space-y-3">
          {todos.length === 0 && (
            <div className="py-16 text-center text-muted text-sm">{t('还没有待办，分析笔记时会自动提取。')}</div>
          )}
          {todos.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${item.status === 'done' ? 'border-app bg-app/40' : 'border-app bg-card hover:border-primary-500/40'}`}
            >
              {<button
                type="button"
                onClick={() => toggleTodo(item)}
                className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${item.status === 'done' ? 'bg-primary-600 border-primary-600 text-white' : 'border-app text-transparent hover:border-primary-500'}`}
                aria-label={t('标记完成')}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
              </button>}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.status === 'done' ? 'line-through text-muted' : 'text-main'}`}>{item.title}</p>
                <p className="text-xs text-muted mt-1">
                  {item.due_at ? t('截止 {d}', { d: String(item.due_at).slice(0, 16).replace('T', ' ') }) : t('没有截止时间')}
                  {item.remind_before ? ` · ${t('提前 {n} 分钟提醒', { n: item.remind_before })}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'important' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {important.length === 0 && (
            <div className="md:col-span-2 py-16 text-center text-muted text-sm">{t('还没有重要事项。')}</div>
          )}
          {important.map((item) => (
            <div
              key={item.id}
              className="border rounded-xl p-5 bg-card space-y-2 transition-colors border-app relative group"
            >
              <p className="text-sm font-medium text-main pr-8">{item.title}</p>
              {item.detail && <p className="text-sm text-muted whitespace-pre-wrap">{item.detail}</p>}
              <button
                type="button"
                title={t('删除')}
                onClick={async () => {
                  if (!confirm(t('⚠️ 确定要删除这条重要事项吗？'))) return;
                  try {
                    await api('/api/important/' + item.id, { method: 'DELETE' });
                    if (isAll) await load(q, true); else await loadOverview(activeCat.id);
                  } catch (e) { setErr(e.message); }
                }}
                className="absolute top-3 right-3 p-1.5 rounded-md text-muted opacity-40 hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && createPortal(
        <EditCardModal card={editing} onClose={() => setEditing(null)} onSaved={onSaved} onUpdated={onUpdated} />,
        document.body
      )}
    </div>
          </div>
      </div>
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
