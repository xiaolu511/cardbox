import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export default function CardsPage({ active = true }) {
  const [q, setQ] = useState('');
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState('');
  
  // 🌟 分页状态
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

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

  async function delCard(id) {
    if (!confirm('确定要删除这张卡片吗？')) return;
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' });
      // 删完重拉第一页：只从本地数组里抠掉一条会让 offset 分页错位，下一页漏一张
      await load(q, true);
    } catch (e) { alert(e.message); }
  }

  return (
    <div className="space-y-6 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <form onSubmit={(e) => { e.preventDefault(); load(q, true); }} className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="搜问题或答案（支持全文检索）..."
          className="flex-1 border border-app bg-transparent text-main p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm placeholder-gray-400"
        />
        <button className="px-5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors text-sm">搜索</button>
      </form>

      {err && <p className="text-red-500 text-sm">{err}</p>}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => (
          <div key={c.id} className="border border-app rounded-xl p-5 space-y-3 bg-card group hover:shadow-md transition-all flex flex-col h-full relative">
            <div className="flex justify-between items-start gap-4">
              <h3 className="font-bold text-main text-base leading-snug">{c.question}</h3>
              <button onClick={() => delCard(c.id)} className="text-muted hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100" title="删除卡片">✕</button>
            </div>
            <p className="text-sm text-muted whitespace-pre-wrap flex-1">{c.answer}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {(() => {
                try { return JSON.parse(c.tags).map(t => <span key={t} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-md font-medium">{t}</span>); } 
                catch { return null; }
              })()}
            </div>
            <div className="mt-auto pt-4 border-t border-app">
              <div className="flex items-start gap-2 text-xs text-muted cursor-pointer hover:text-primary-600 transition-colors" title={c.note_text}>
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span className="line-clamp-2 leading-relaxed">来源：{c.note_text}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {cards.length === 0 && !err && (
        <div className="h-[calc(100vh-300px)] flex flex-col items-center justify-center text-muted animate-page">
          <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
          <p className="text-lg font-medium">{q ? '没有搜到相关卡片' : '还没有卡片，去「笔记」页拆几张吧'}</p>
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
            {loading ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}