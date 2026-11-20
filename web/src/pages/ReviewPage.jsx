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
  if (!card) return <p className="text-muted text-center mt-10">🎉 今天的复习任务已全部完成！</p>;

  return (
    <div className="max-w-xl mx-auto space-y-4 mt-8 bg-card p-8 rounded-2xl shadow-sm border border-app transition-colors duration-300">
      <p className="text-xs text-muted text-center">待复习：{queue.length - idx} 张</p>
      
      <div className="border border-app rounded-xl p-8 min-h-[200px] flex flex-col justify-center bg-app/50">
        <p className="font-medium text-lg text-center text-main">{card.question}</p>
        {flipped && <div className="mt-6 border-t border-app pt-4 text-muted whitespace-pre-wrap">{card.answer}</div>}
      </div>

      {!flipped ? (
        <button onClick={() => setFlipped(true)} className="w-full py-3 bg-primary-600 text-white rounded-lg shadow hover:bg-primary-700 transition-colors">
          显示答案
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <button onClick={() => grade('again')} className="py-2.5 bg-red-500/10 text-red-600 font-medium rounded-lg hover:bg-red-500/20 transition-colors">忘了</button>
          <button onClick={() => grade('hard')} className="py-2.5 bg-orange-500/10 text-orange-600 font-medium rounded-lg hover:bg-orange-500/20 transition-colors">模糊</button>
          <button onClick={() => grade('good')} className="py-2.5 bg-green-500/10 text-green-600 font-medium rounded-lg hover:bg-green-500/20 transition-colors">记得</button>
          <button onClick={() => grade('easy')} className="py-2.5 bg-emerald-500/20 text-emerald-700 font-medium rounded-lg hover:bg-emerald-500/30 transition-colors">太简单</button>
        </div>
      )}
    </div>
  );
}