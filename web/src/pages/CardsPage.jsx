import { useEffect, useState } from 'react';
import { api } from '../api';

// tags 是 TEXT 存的 JSON 字符串；老数据/损坏数据会让 JSON.parse 抛错，
// 之前一条坏卡就能把整个页面崩成白屏。解析失败就当没有标签，卡片照常显示。
function parseTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => typeof t === 'string' && t.trim() !== '');
  } catch {
    return [];
  }
}

export default function CardsPage() {
  const [q, setQ] = useState('');
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState('');

  async function load(keyword = '') {
    setErr('');
    try {
      setCards(await api(`/api/cards${keyword ? `?q=${encodeURIComponent(keyword)}` : ''}`));
    } catch (e) {
      setErr(e.message);
    }
  }
  
  useEffect(() => { load(); }, []);

  async function delCard(id) {
    if (!confirm('确定要删除这张卡片吗？')) return;
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' });
      setCards(cards.filter(c => c.id !== id));
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-6 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <form onSubmit={(e) => { e.preventDefault(); load(q); }} className="flex gap-2">
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
              <button 
                onClick={() => delCard(c.id)} 
                className="text-muted hover:text-red-500 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                title="删除卡片"
              >
                ✕
              </button>
            </div>
            
            <p className="text-sm text-muted whitespace-pre-wrap flex-1">{c.answer}</p>
            
            <div className="flex flex-wrap gap-2 pt-1">
              {parseTags(c.tags).map((t) => (
                <span key={t} className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-md font-medium">{t}</span>
              ))}
            </div>

            {/* 来源笔记关联展示 */}
            <div className="mt-auto pt-4 border-t border-app">
              <div 
                className="flex items-start gap-2 text-xs text-muted cursor-pointer hover:text-primary-600 transition-colors"
                title={c.note_text}
              >
                <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span className="line-clamp-2 leading-relaxed">
                  来源：{c.note_text}
                </span>
              </div>
            </div>

          </div>
        ))}
      </div>
      
      {cards.length === 0 && !err && (
        <div className="text-center py-12 text-muted text-sm">
          没有搜到相关卡片，去「笔记」页拆几张吧。
        </div>
      )}
    </div>
  );
}