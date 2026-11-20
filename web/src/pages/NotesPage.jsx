import { useEffect, useState } from 'react';
import { api } from '../api';

export default function NotesPage() {
  const [text, setText] = useState('');
  const [notes, setNotes] = useState([]);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setNotes(await api('/api/notes'));
  }
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []);

  async function add() {
    if (!text.trim()) return;
    setErr('');
    try {
      await api('/api/notes', { method: 'POST', body: { raw_text: text } });
      setText('');
      await load();
    } catch (e) { setErr(e.message); }
  }

  async function split(id) {
    setBusyId(id);
    setErr('');
    try {
      const r = await api(`/api/notes/${id}/cards`, { method: 'POST' });
      if (r.created === 0) {
        alert('⚠️ 这条笔记之前已经拆过卡了，没有新增卡片。');
      } else {
        alert(`🎉 成功拆出 ${r.created} 张卡片！`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function del(id) {
    if (!confirm('⚠️ 确定要删除这条笔记吗？它拆出来的所有卡片也会被一起删除！')) return;
    setErr('');
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e.message);
    }
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
              <span className="text-muted">{n.created_at}</span>
              
              <div className="ml-auto flex gap-4">
                <button
                  onClick={() => del(n.id)}
                  className="text-muted hover:text-red-500 transition-colors"
                >
                  删除
                </button>
                
                <button
                  onClick={() => split(n.id)}
                  disabled={busyId === n.id}
                  className="text-primary-600 font-medium hover:underline disabled:opacity-50"
                >
                  {busyId === n.id ? 'AI 拆卡中...' : '✨ 拆成卡片'}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}