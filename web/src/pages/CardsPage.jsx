import { useEffect, useState } from 'react';
import { api } from '../api';

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

  // 🌟 新增：删除卡片函数
  async function delCard(id) {
    if (!confirm('确定要删除这张卡片吗？')) return;
    try {
      await api(`/api/cards/${id}`, { method: 'DELETE' });
      setCards(cards.filter(c => c.id !== id)); // 前端直接剔除，无需重新请求
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); load(q); }} className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="搜问题或答案（支持全文检索）..."
          className="flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button className="px-4 bg-gray-200 rounded hover:bg-gray-300">搜索</button>
      </form>

      {err && <p className="text-red-500 text-sm">{err}</p>}
      
      <ul className="space-y-3">
        {cards.map((c) => (
          <li key={c.id} className="border rounded p-4 space-y-2 bg-white group">
            <div className="flex justify-between items-start">
              <p className="font-medium text-blue-800">{c.question}</p>
              {/* 🌟 新增：删除按钮 */}
              <button 
                onClick={() => delCard(c.id)} 
                className="text-gray-300 hover:text-red-500 text-sm transition-colors opacity-0 group-hover:opacity-100"
                title="删除卡片"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.answer}</p>
            <div className="flex gap-2">
              {JSON.parse(c.tags).map((t) => (
                <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{t}</span>
              ))}
            </div>
          </li>
        ))}
        {cards.length === 0 && !err && (
          <li className="text-sm text-gray-500">没有搜到相关卡片。</li>
        )}
      </ul>
    </div>
  );
}