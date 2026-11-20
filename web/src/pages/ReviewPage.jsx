import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ReviewPage() {
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/review').then(setQueue).catch((e) => setErr(e.message));
  }, []);

  const card = queue[idx];

  async function grade(g) {
    try {
      await api(`/api/cards/${card.id}/review`, { method: 'POST', body: { grade: g } });
      setFlipped(false);
      setIdx((i) => i + 1);
    } catch (e) { setErr(e.message); }
  }

  if (err) return <p className="text-red-500">{err}</p>;
  if (!card) return <p className="text-gray-500 text-center mt-10">🎉 今天的复习任务已全部完成！</p>;

  return (
    <div className="max-w-xl mx-auto space-y-4 mt-8">
      <p className="text-xs text-gray-500 text-center">待复习：{queue.length - idx} 张</p>
      <div className="border rounded p-8 min-h-[200px] flex flex-col justify-center shadow-sm bg-white">
        <p className="font-medium text-lg text-center">{card.question}</p>
        {flipped && <div className="mt-6 border-t pt-4 text-gray-700 whitespace-pre-wrap">{card.answer}</div>}
      </div>

      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="w-full py-3 bg-blue-600 text-white rounded shadow hover:bg-blue-700">
          显示答案
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => grade('again')} className="py-2 bg-red-100 text-red-700 rounded hover:bg-red-200">忘了</button>
          <button onClick={() => grade('hard')} className="py-2 bg-orange-100 text-orange-700 rounded hover:bg-orange-200">模糊</button>
          <button onClick={() => grade('good')} className="py-2 bg-green-100 text-green-700 rounded hover:bg-green-200">记得</button>
          <button onClick={() => grade('easy')} className="py-2 bg-emerald-200 text-emerald-800 rounded hover:bg-emerald-300">太简单</button>
        </div>
      )}
    </div>
  );
}