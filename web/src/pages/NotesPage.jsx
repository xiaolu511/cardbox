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
      // 如果后端返回 created 为 0，说明被唯一约束拦截了
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

  // 🌟 新增：删除笔记函数
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
    <div className="space-y-4">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)}
        placeholder="粘贴一段笔记，比如：TCP 三次握手是为了确认双方收发能力都正常……"
        className="w-full h-32 p-3 border rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex items-center gap-3">
        <button onClick={add} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存笔记</button>
        {err && <span className="text-red-500 text-sm">{err}</span>}
      </div>
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="border rounded p-3 bg-white">
            <p className="whitespace-pre-wrap text-sm">{n.raw_text}</p>
            <div className="mt-3 flex items-center gap-4 text-xs border-t pt-2">
              <span className="text-gray-400">{n.created_at}</span>
              
              <div className="ml-auto flex gap-4">
                {/* 🌟 新增：删除按钮 */}
                <button
                  onClick={() => del(n.id)}
                  className="text-gray-500 hover:text-red-600 transition-colors"
                >
                  删除
                </button>
                
                <button
                  onClick={() => split(n.id)}
                  disabled={busyId === n.id}
                  className="text-blue-600 font-medium hover:underline disabled:opacity-50"
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