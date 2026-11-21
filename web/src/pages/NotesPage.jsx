import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

// 库里存的是 UTC（'YYYY-MM-DD HH:MM:SS'），直接显示会差 8 小时
const fmtTime = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function NotesPage({ active = true }) {
  const [text, setText] = useState('');
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  
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

  async function add() {
    if (!text.trim()) return;
    setErr('');
    try {
      await api('/api/notes', { method: 'POST', body: { raw_text: text } });
      setText('');
      await load(true); // 保存后重置分页
    } catch (e) { setErr(e.message); }
  }

  async function split(id) {
    setBusyId(id);
    setErr('');
    try {
      const r = await api(`/api/notes/${id}/cards`, { method: 'POST' });
      if (r.created === 0) alert('⚠️ 这条笔记之前已经拆过卡了。');
      else alert(`🎉 成功拆出 ${r.created} 张卡片！`);
    } catch (e) { setErr(e.message); } finally { setBusyId(null); }
  }

  async function del(id) {
    if (!confirm('⚠️ 确定要删除这条笔记吗？')) return;
    setErr('');
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      await load(true);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="space-y-4 bg-card p-6 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="粘贴一段笔记，比如：TCP 三次握手是为了确认双方收发能力都正常……"
        className="w-full h-32 p-3 border border-app bg-transparent text-main rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 placeholder-gray-400"
      />
      <div className="flex items-center gap-3">
        <button onClick={add} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">保存笔记</button>
        {err && <span className="text-red-500 text-sm">{err}</span>}
      </div>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="border border-app rounded-xl p-4 bg-card transition-colors duration-300">
            <p className="whitespace-pre-wrap text-sm text-main">{n.raw_text}</p>
            <div className="mt-3 flex items-center gap-4 text-xs border-t border-app pt-3">
              <span className="text-muted">{fmtTime(n.created_at)}</span>
              <div className="ml-auto flex gap-4">
                <button onClick={() => del(n.id)} className="text-muted hover:text-red-500 transition-colors">删除</button>
                <button onClick={() => split(n.id)} disabled={busyId === n.id} className="text-primary-600 font-medium hover:underline disabled:opacity-50">
                  {busyId === n.id ? 'AI 拆卡中...' : '✨ 拆成卡片'}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      
      {/* 🌟 加载更多按钮 */}
      {hasMore && (
        <div className="text-center pt-4">
          <button 
            onClick={() => load(false)} 
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