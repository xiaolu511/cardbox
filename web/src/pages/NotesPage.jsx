import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, upload } from '../api';
import { onDropFile } from '../dropbus';
import { t, useI18n, getLang } from '../i18n';

// 库里存的是 UTC（'YYYY-MM-DD HH:MM:SS'），直接显示会差 8 小时
const fmtTime = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const isLongNote = (v) => String(v || '').length > 200 || String(v || '').split('\n').length > 6;

const previewOf = (v) => {
  const raw = String(v || '').trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 4).join('\n');
  const cut = lines.length > 4 || head.length < raw.length;
  const text = cut ? head + '…' : head;
  // 单行长文：按字符数兜底，否则整段都会显示出来
  return text.length > 240 ? text.slice(0, 240) + '…' : text;
};

export default function NotesPage({ active = true }) {
  // 从窗口任意位置拖进来的文件，解析完走这里
  useEffect(() => {
    const off = onDropFile(({ name, text }) => {
      setText(text || '');
      setDropMsg(t('已导入 {name}，共 {n} 字', { name, n: String(text || '').length }));
      setTimeout(() => setDropMsg(''), 4000);
    });
    return off;
  }, []);
  useI18n();
  const [text, setText] = useState('');
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  // 拆卡前先问张数；null = 没在选择。ids 可能是一条，也可能是批量选中的多条。
  const [splitTarget, setSplitTarget] = useState(null);
  const [analysisForm, setAnalysisForm] = useState({ instruction: '', thinking: 'standard' });
  const [progress, setProgress] = useState({ open: false, step: 0, idx: 0, total: 1, category: '', error: '', done: false, result: null });
  // 导入到哪个分类：'auto' = 让 AI 判断，数字 = 已有分类 id，'new' = 新建
  const [categories, setCategories] = useState([]);
  const [catChoice, setCatChoice] = useState('');
  const [newCatName, setNewCatName] = useState('');
  const [useRefine, setUseRefine] = useState(false); // 保存前先让 AI 精简一遍
  const [refining, setRefining] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  // 没配 Key 时不让拆卡，点了给提示而不是直接走 Mock
  const [hasKey, setHasKey] = useState(null);
  const fileRef = useRef(null);
  // 批量模式
  const [batchMode, setBatchMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [dropMsg, setDropMsg] = useState('');
  const toggleExpand = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const [batchBusy, setBatchBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    api('/api/settings').then((r) => setHasKey(Boolean(r && r.hasKey))).catch(() => setHasKey(null));
  }, [active]);

  useEffect(() => {
    if (!splitTarget) return;
    setNewCatName('');
    api('/api/categories')
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        setCategories(list);
        // 不再由 AI 归类，也不预设：让用户自己选
        setCatChoice('');
      })
      .catch(() => { setCategories([]); setCatChoice('new'); });
  }, [splitTarget]);

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
      let raw = text;
      if (useRefine) {
        setRefining(true);
        try {
          const r = await api('/api/refine', { method: 'POST', body: { text, lang: getLang() } });
          const refined = (r?.data ?? r)?.text;
          if (refined && refined.trim()) raw = refined.trim();
        } finally {
          setRefining(false);
        }
      }
      await api('/api/notes', { method: 'POST', body: { raw_text: raw } });
      setText('');
      await load(true); // 保存后重置分页
    } catch (e) { setErr(e.message); }
  }

  async function onPickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportMsg(t('正在读取 {name}...', { name: file.name }));
    setErr('');
    try {
      const r = await upload('/api/extract', file);
      setText(r.text);
      setImportMsg(t('已导入 {name}，共 {n} 字', { name: r.filename, n: r.chars }));
      setTimeout(() => setImportMsg(''), 4000);
    } catch (err) {
      setImportMsg('');
      setErr(err.message);
    }
  }

  async function runAnalysis(ids) {
    if (!catChoice) {
      setErr(t('请选择一个分类（也可以新建一个）。'));
      return;
    }
    if (catChoice === 'new' && !newCatName.trim()) {
      setErr(t('请先给新分类起个名字，或选择一个已有分类。'));
      return;
    }
    if (hasKey === false) {
      setErr(t('还没有配置 API Key，先去「设置」填上再拆卡。'));
      return;
    }
    const list = Array.isArray(ids) ? ids : [ids];
    setErr('');
    setProgress({ open: true, step: 0, idx: 1, total: list.length, category: '', error: '', done: false, result: null });
    let cards = 0, todos = 0, importants = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        setProgress((p) => ({ ...p, idx: i + 1, step: 0, error: '', category: '' }));
        await new Promise((r) => setTimeout(r, 240));
        setProgress((p) => ({ ...p, step: 1 }));
        let analysis;
        try {
          analysis = await api(`/api/notes/${id}/analyze`, {
            method: 'POST',
            body: {
              lang: getLang(),
              instruction: analysisForm.instruction,
              thinking: analysisForm.thinking,
              categoryId: catChoice !== 'auto' && catChoice !== 'new' ? Number(catChoice) : undefined,
              categoryName: catChoice === 'new' ? newCatName.trim() || undefined : undefined,
            },
          });
        } catch (e) {
          setProgress((p) => ({ ...p, error: e.message }));
          return;
        }
        const chosen = catChoice === 'new' ? newCatName.trim() : (catChoice === 'auto' ? '' : (categories.find((c) => String(c.id) === String(catChoice))?.name || ''));
        setProgress((p) => ({ ...p, step: 2, category: chosen || analysis.category || '' }));
        await new Promise((r) => setTimeout(r, 700));
        setProgress((p) => ({ ...p, step: 3 }));
        try {
          const r = await api(`/api/notes/${id}/apply`, {
            method: 'POST',
            body: {
              analysis: {
                cards: analysis.cards || [],
                todos: analysis.todos || [],
                important: analysis.important || [],
                summary: analysis.summary || '',
                category: analysis.category || '',
              },
              categoryId: catChoice !== 'auto' && catChoice !== 'new' ? Number(catChoice) : undefined,
              categoryName: catChoice === 'new' ? newCatName.trim() || undefined : undefined,
            },
          });
          cards += (r.created && r.created.cards) || 0;
          todos += (r.created && r.created.todos) || 0;
          importants += (r.created && r.created.important) || 0;
        } catch (e) {
          setProgress((p) => ({ ...p, error: e.message }));
          return;
        }
        setProgress((p) => ({ ...p, step: 4 }));
      }
      setProgress((p) => ({ ...p, done: true, result: { cards, todos, importants } }));
      await load(true);
    } finally {
      setSplitTarget(null);
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

  const allSelected = notes.length > 0 && sel.size === notes.length;

  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(notes.map((n) => n.id)));
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
        className="w-full h-32 p-3 border border-app bg-transparent text-main rounded-lg font-app text-app leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-400"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={add} disabled={refining} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
          {refining ? t('正在精简...') : t('保存笔记')}
        </button>
        <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
          <input
            type="checkbox" checked={useRefine} onChange={(e) => setUseRefine(e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--custom-primary)]"
          />
          {t('保存前先精简')}
        </label>
        <input
          type="file" ref={fileRef} onChange={onPickFile} className="hidden"
          accept=".txt,.md,.markdown,.docx,.pdf"
        />
        <button
          onClick={() => fileRef.current.click()}
          className="px-4 py-2 rounded-lg border border-app text-main hover:border-primary-500/60 transition-colors"
        >{t('导入文件')}</button>
        {!batchMode ? (
          <button
            onClick={() => setBatchMode(true)}
            className="px-4 py-2 rounded-lg border border-app text-main hover:border-primary-500/60 transition-colors"
          >{t('批量')}</button>
        ) : (
          <>
            <span className="text-sm text-muted">{t('已选 {n} 条', { n: sel.size })}</span>
            <button
              onClick={toggleAll}
              disabled={notes.length === 0}
              className="px-3 py-2 rounded-lg text-sm text-primary-600 hover:underline disabled:opacity-40"
            >{allSelected ? t('取消全选') : t('全选')}</button>
            <button
              onClick={() => { if (sel.size) { if (hasKey === false) { setErr(t('还没有配置 API Key，先去「设置」填上再拆卡。')); return; } setAnalysisForm({ instruction: '', thinking: 'standard' }); setSplitTarget({ ids: [...sel] }); } }}
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
        {importMsg && <span className="text-sm text-muted">{importMsg}</span>}
        {err && <span className="text-red-500 text-sm">{err}</span>}
        {dropMsg && <span className="text-green-600 text-sm animate-page">{dropMsg}</span>}
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
                <p className="whitespace-pre-wrap text-sm text-main">
                  {expanded.has(n.id) ? n.raw_text : previewOf(n.raw_text)}
                </p>
                {isLongNote(n.raw_text) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(n.id); }}
                    className="mt-1 text-xs text-primary-600 hover:underline"
                  >
                    {expanded.has(n.id) ? t('收起') : t('展开全部')}
                  </button>
                )}
                <div className="mt-3 flex items-center gap-4 text-xs border-t border-app pt-3">
                  <span className="text-muted">{fmtTime(n.created_at)}</span>
                  <div className="ml-auto flex gap-4">
                    <button onClick={(e) => { e.stopPropagation(); del(n.id); }} className="text-muted hover:text-red-500 transition-colors">{t('删除')}</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (hasKey === false) { setErr(t('还没有配置 API Key，先去「设置」填上再拆卡。')); return; } setAnalysisForm({ instruction: '', thinking: 'standard' }); setSplitTarget({ ids: [n.id] }); }}
                      disabled={busyId === n.id || busyId === 'batch'}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-sm font-medium shadow-sm transition-all ${hasKey === false ? 'bg-primary-600/40 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700 active:scale-[0.98]'} disabled:opacity-50`}
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
          <div className="w-full max-w-md bg-card border border-app rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-app">
              <h3 className="font-bold text-main">
                {splitTarget.ids.length > 1 ? t('批量分析') : t('拆成卡片')}
              </h3>
              <p className="text-xs text-muted mt-1 truncate">
                {splitTarget.ids.length > 1
                  ? t('已选 {n} 条', { n: splitTarget.ids.length })
                  : (notes.find((x) => x.id === splitTarget.ids[0])?.raw_text || '')}
              </p>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-main mb-1.5">{t('分析要求（可选）')}</label>
                <textarea
                  value={analysisForm.instruction}
                  onChange={(e) => setAnalysisForm((f) => ({ ...f, instruction: e.target.value }))}
                  rows={3}
                  placeholder={t('例如：只考概念、忽略例子；或：重点标出时间地点')}
                  className="w-full px-3 py-2 rounded-lg border border-app bg-app text-sm text-main resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-main mb-1.5">{t('思考程度')}</label>
                <div className="flex gap-2">
                  {[
                    { key: 'fast', label: t('快速') },
                    { key: 'standard', label: t('标准') },
                    { key: 'deep', label: t('深入') },
                  ].map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setAnalysisForm((f) => ({ ...f, thinking: o.key }))}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm border transition-colors ${analysisForm.thinking === o.key ? 'border-primary-500 bg-primary-600/10 text-primary-600 font-medium' : 'border-app text-muted hover:border-primary-500/50'}`}
                    >{o.label}</button>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1.5">{t('越深入，挖出的待办和重要事项越多，耗时也更长。')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-main mb-1.5">{t('导入到分类')}</label>
                <select
                  value={catChoice}
                  onChange={(e) => setCatChoice(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-app bg-app text-sm text-main"
                >
                  <option value="">{t('请选择分类')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="new">{t('＋ 新建分类…')}</option>
                </select>
                {catChoice === 'new' && (
                  <input
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder={t('给新分类起个名字')}
                    className="mt-2 w-full px-3 py-2 rounded-lg border border-app bg-app text-sm text-main"
                  />
                )}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-app flex justify-end gap-3">
              <button type="button" onClick={() => setSplitTarget(null)} className="px-4 py-2 rounded-lg text-muted hover-item transition-colors">{t('取消')}</button>
              <button
                type="button"
                onClick={() => runAnalysis(splitTarget.ids)}
                disabled={busyId !== null}
                className={`px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-50 ${hasKey === false ? 'bg-primary-600/40 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-700'}`}
              >{t('开始分析')}</button>
            </div>
          </div>
        </div>, document.body)}

      {progress.open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
          <div className="w-full max-w-sm bg-card border border-app rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-app">
              <h3 className="font-bold text-main">{progress.done ? t('分析完成') : t('正在分析…')}</h3>
              <p className="text-xs text-muted mt-1">
                {t('第 {i} / {n} 条', { i: progress.idx, n: progress.total })}
              </p>
            </div>
            <div className="px-5 py-5 space-y-3">
              {[
                { i: 1, label: t('读取内容') },
                { i: 2, label: t('AI 分析') },
                { i: 3, label: t('归类') },
                { i: 4, label: t('写入卡片') },
              ].map((st) => {
                const active = progress.step === st.i - 1;
                const done = progress.step >= st.i;
                return (
                  <div key={st.i} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border ${done ? 'bg-primary-600 border-primary-600 text-white' : active ? 'border-primary-500 text-primary-600' : 'border-app text-muted'}`}>
                      {done ? '✓' : st.i}
                    </span>
                    <span className={`text-sm ${done || active ? 'text-main' : 'text-muted'}`}>{st.label}</span>
                    {active && !progress.done && (
                      <span className="ml-auto flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce [animation-delay:120ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce [animation-delay:240ms]" />
                      </span>
                    )}
                  </div>
                );
              })}
              {progress.step === 2 && progress.category && (
                <p className="text-xs text-muted pl-9">{t('识别到的分类：{name}', { name: progress.category })}</p>
              )}
              {progress.error && (
                <p className="text-sm text-red-500 pl-9">{progress.error}</p>
              )}
              {progress.done && (
                <div className="text-sm text-main pl-9 space-y-1">
                  <p>{t('生成 {n} 张卡片', { n: (progress.result && progress.result.cards) || 0 })}</p>
                  {!!(progress.result && progress.result.todos) && (
                    <p>{t('记下 {n} 条待办', { n: progress.result.todos })}</p>
                  )}
                  {!!(progress.result && progress.result.importants) && (
                    <p>{t('标记 {n} 条重要事项', { n: progress.result.importants })}</p>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-app flex justify-end">
              <button
                type="button"
                onClick={() => setProgress({ open: false, step: 0, idx: 0, total: 1, category: '', error: '', done: false, result: null })}
                disabled={!progress.done && !progress.error}
                className="px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-40"
              >{progress.done ? t('完成') : t('关闭')}</button>
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
