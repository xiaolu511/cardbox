import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useModalPresence } from '../modalAnim';
import { api } from '../api';
import { getStrictness } from '../judgePrefs';
import { setFocusMode } from '../focusbus';
import { t, useI18n, getLang } from './../i18n';

const GRADE_CONFIG = [
  { grade: 'again', label: '忘了', sub: '今天', key: '1', icon: 'M6 18L18 6M6 6l12 12', bg: 'bg-red-500/10', hoverBg: 'hover:bg-red-500/20', border: 'border-red-500/20', hoverBorder: 'hover:border-red-500/40', text: 'text-red-500', textBold: 'text-red-600' },
  { grade: 'hard', label: '模糊', sub: '明天', key: '2', icon: 'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z', bg: 'bg-orange-500/10', hoverBg: 'hover:bg-orange-500/20', border: 'border-orange-500/20', hoverBorder: 'hover:border-orange-500/40', text: 'text-orange-500', textBold: 'text-orange-600' },
  { grade: 'good', label: '记得', sub: '3天后', key: '3', icon: 'M5 13l4 4L19 7', bg: 'bg-green-500/10', hoverBg: 'hover:bg-green-500/20', border: 'border-green-500/20', hoverBorder: 'hover:border-green-500/40', text: 'text-green-500', textBold: 'text-green-600' },
  { grade: 'easy', label: '太简单', sub: '7天后', key: '4', icon: 'M13 10V3L4 14h7v7l9-11h-7z', bg: 'bg-emerald-500/10', hoverBg: 'hover:bg-emerald-500/20', border: 'border-emerald-500/20', hoverBorder: 'hover:border-emerald-500/40', text: 'text-emerald-500', textBold: 'text-emerald-600' },
];

// 近 7 天柱状图：数据由后端按本地时区聚合好（last7d），这里只负责贴上星期标签。
const buildChart = (last7d) => {
  if (!Array.isArray(last7d)) return [];
  return last7d.map((d) => {
    const [y, m, day] = d.date.split('-').map(Number);
    const locale = { zhCN: 'zh-CN', zhTW: 'zh-TW', en: 'en-US' }[getLang()] || 'zh-CN';
    const label = new Date(y, m - 1, day).toLocaleDateString(locale, { weekday: 'short' });
    return { key: d.date, label, count: d.count || 0 };
  });
};

const emptyStats = { due: 0, mastered: 0, total: 0, todayReviewed: 0, last7d: [] };

export default function ReviewPage({ active, categoryId = 'all' }) {
  // 分类（文件夹）决定复习范围：文件夹 -> 卡片。没有选中分类时退回按笔记列表选。
  const scoped = categoryId && categoryId !== 'all';
  useI18n();
  const [view, setView] = useState('home');
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState('all');
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  
  // 数据看板状态（全部来自后端，不再用 localStorage）
  const [serverStats, setServerStats] = useState(emptyStats);
  const [chartData, setChartData] = useState([]);

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState('');            // 学员自己写的答案
  const [judge, setJudge] = useState(null);          // { loading, verdict, comment }
  const [autoGraded, setAutoGraded] = useState(false); // AI 已落评分，答案锁定
  const [answerErr, setAnswerErr] = useState('');
  const [detailGrade, setDetailGrade] = useState(null);

  // 本轮复习的临时战报（只活在内存里，刷新即清）
  const [session, setSession] = useState({ done: 0, details: [] });

  // 三张统计卡点开的详情抽屉
  const [detail, setDetail] = useState(null); // { type, title, items, loading, error }

  // 弹窗进出场（关闭时先播退场再卸载）
  const detailModal = useModalPresence(!!detail);

  // 🌟 加载主页数据
  // hide sidebar while answering, so the user cannot switch tabs mid-review
  useEffect(() => {
    setFocusMode(view === 'session');
    return () => setFocusMode(false);
  }, [view]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      if (scoped) {
        const ov = await api('/api/categories/' + categoryId + '/overview');
        setNotes(ov.cards.map((c) => ({ id: c.id, question: c.question })));
      } else {
        const notesRes = await api('/api/notes?limit=100');
        setNotes(notesRes.data);
      }

      const statsRes = await api('/api/stats' + (scoped ? '?category_id=' + categoryId : ''));
      setServerStats(statsRes);

      setChartData(buildChart(statsRes.last7d));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [categoryId, scoped]);

  // 🌟 核心修复：监听 active 变化，切到当前页面时刷新数据
  useEffect(() => {
    if (active && view === 'home') {
      loadDashboard();
    }
  }, [active, view, loadDashboard]);

  const startSession = async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      if (scoped) qs.set('category_id', categoryId);
      if (selectedNote !== 'all') {
        if (scoped) qs.set('card_id', selectedNote); else qs.set('note_id', selectedNote);
      }
      const data = await api('/api/review' + (qs.toString() ? '?' + qs : ''));
      if (data.length === 0) {
        alert(t('当前选择范围内没有需要复习的卡片！'));
        setLoading(false);
        return;
      }
      setQueue(data);
      setIdx(0);
      setFlipped(false);
    setTyped('');
    setJudge(null);
    setAnswerErr('');
      setSession({ done: 0, details: [] });
      setView('session');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const card = queue[idx];

  // 点开统计卡：拉这批卡的清单
  const openDetail = async (type, title) => {
    setDetail({ type, title, items: [], loading: true, error: '' });
    try {
      const items = await api(`/api/stats/cards?type=${type}`);
      setDetail({ type, title, items, loading: false, error: '' });
    } catch (e) {
      setDetail({ type, title, items: [], loading: false, error: e.message });
    }
  };

  // 加练：直接拿详情里的这批卡当队列，走正常复习流程（评分照常写流水、推后下次时间）
  const startExtra = () => {
    if (!detail || detail.items.length === 0) return;
    setQueue(detail.items);
    setIdx(0);
    setFlipped(false);
    setTyped('');
    setJudge(null);
    setAnswerErr('');
    setSession({ done: 0, details: [] });
    setDetail(null);
    setView('session');
  };


  // 学员先自己写，提交后交给 AI 比对标准答案；太敷衍的会被打回，不让直接评分
  const submitAnswer = async () => {
    if (!card) return;
    const text = typed.trim();
    if (!text) { setAnswerErr(t('答案不能为空')); return; }
    setAnswerErr('');
    setJudge({ loading: true });
    try {
      const r = await api(`/api/cards/${card.id}/judge`, {
        method: 'POST',
        body: { answer: text, lang: getLang(), strictness: getStrictness() },
      });
      const data = r?.data ?? r;
      const v = data.verdict;
      setJudge({ verdict: v, comment: data.comment || '', score: data.score });
      setFlipped(true);
      // 评分只由 AI 决定：对了 3 天后，其余（含太简单）明天再来
      const g = v === 'correct' ? 'good' : v === 'partial' ? 'hard' : 'again';
      await api(`/api/cards/${card.id}/review`, { method: 'POST', body: { grade: g } });
      setSession((s2) => ({ done: s2.done + 1, details: [...s2.details, { ...card, grade: g }] }));
      setServerStats((s2) => ({
        ...s2,
        due: Math.max(s2.due - 1, 0),
        todayReviewed: s2.todayReviewed + 1,
        mastered: g === 'good' ? Math.min(s2.mastered + 1, s2.total) : s2.mastered,
      }));
      setAutoGraded(true);
    } catch (e) {
      setJudge(null);
      setAnswerErr(e.message);
    }
  };

  const verdictLabel = (v) => ({
    correct: t('AI 判定：正确'),
    partial: t('AI 判定：基本正确'),
    wrong: t('AI 判定：不太对'),
    too_simple: t('AI 判定：答案太简单'),
  }[v] || '');

  const verdictStyle = (v) => ({
    correct: 'bg-green-500/10 border-green-500/30 text-green-600',
    partial: 'bg-orange-500/10 border-orange-500/30 text-orange-600',
    wrong: 'bg-red-500/10 border-red-500/30 text-red-600',
    too_simple: 'bg-amber-500/10 border-amber-500/30 text-amber-600',
  }[v] || 'bg-app border-app text-muted');

  const tooSimple = judge?.verdict === 'too_simple';

  const grade = useCallback(async (g) => {
    if (!card) return;
    try {
      await api(`/api/cards/${card.id}/review`, { method: 'POST', body: { grade: g } });
      setSession(s => ({ done: s.done + 1, details: [...s.details, { ...card, grade: g }] }));
      // 评分后本地先更新，省一次往返；回到首页时 loadDashboard 会用后端真值覆盖
      setServerStats(s => ({
        ...s,
        due: Math.max(s.due - 1, 0),
        todayReviewed: s.todayReviewed + 1,
        mastered: g === 'good' || g === 'easy' ? Math.min(s.mastered + 1, s.total) : s.mastered,
      }));
      setFlipped(false);
    setTyped('');
    setJudge(null);
    setAnswerErr('');
      setIdx(i => i + 1);
      if (idx + 1 >= queue.length) setView('summary');
    } catch (e) { setErr(e.message); }
  }, [card, idx, queue.length]);

  useEffect(() => {
    const handler = (e) => {
      if (view !== 'session' || detailGrade) return;
      if (!card) return;
      if (!flipped) {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); setFlipped(true); }
      } else {
        const item = GRADE_CONFIG.find(item => item.key === e.key);
        if (item) grade(item.grade);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flipped, card, grade, view, detailGrade]);


  // ================= 视图 1：主页看板 =================
  if (view === 'home') {
    // 计算掌握率
    const masteryRate = serverStats.total > 0 ? Math.round((serverStats.mastered / serverStats.total) * 100) : 0;
    const maxChartCount = Math.max(...chartData.map(d => d.count), 10);
    const weekTotal = chartData.reduce((sum, d) => sum + d.count, 0);

    return (
      <>
      <div className="max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto animate-page">
        <h2 className="text-2xl font-bold text-main mb-6">{t('复习中心')}</h2>
        
        {/* 数据面板 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div
            onClick={() => openDetail('due', '今日待复习')}
            className="bg-card border border-app p-6 rounded-2xl shadow-sm relative overflow-hidden cursor-pointer transition-colors hover:border-primary-500/40"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-16 h-16 text-primary-600" fill="currentColor" viewBox="0 0 20 20"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"></path></svg>
            </div>
            <p className="text-sm font-medium text-muted mb-1">{t('今日待复习')}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-primary-600">{serverStats.due}</p>
              <p className="text-sm text-muted">{t('张')}</p>
            </div>
          </div>

          <div
            onClick={() => openDetail('today', '今日已复习')}
            className="bg-card border border-app p-6 rounded-2xl shadow-sm relative overflow-hidden cursor-pointer transition-colors hover:border-primary-500/40"
          >
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-16 h-16 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
            </div>
            <p className="text-sm font-medium text-muted mb-1">{t('今日已复习')}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-green-500">{serverStats.todayReviewed}</p>
              <p className="text-sm text-muted">{t('张')}</p>
            </div>
          </div>

          <div
            onClick={() => openDetail('mastered', '已掌握')}
            className="bg-card border border-app p-6 rounded-2xl shadow-sm relative overflow-hidden cursor-pointer transition-colors hover:border-primary-500/40"
          >
            <p className="text-sm font-medium text-muted mb-1">{t('知识库掌握度')}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-4xl font-bold text-main">{masteryRate}%</p>
            </div>
            {/* 进度条 */}
            <div className="mt-3 h-2 w-full bg-app rounded-full overflow-hidden">
              <div className="h-full bg-primary-600 rounded-full transition-all duration-1000" style={{ width: `${masteryRate}%` }} />
            </div>
            <p className="text-xs text-muted mt-2">
              {t('已掌握 {n} / 总计 {m} 张', { n: serverStats.mastered, m: serverStats.total })}
              <button
                onClick={(e) => { e.stopPropagation(); openDetail('unmastered', '未掌握'); }}
                className="ml-2 text-primary-600 hover:underline"
              >
                {t('看未掌握')}
              </button>
            </p>
          </div>
        </div>

        {/* 图表区 & 开始操作区 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 近7天趋势 */}
          <div className="bg-card border border-app p-6 rounded-2xl shadow-sm flex flex-col">
            <h3 className="text-sm font-bold text-main mb-6">{t('近 7 天复习活跃度')}</h3>
            {weekTotal === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <p className="text-sm text-muted">{t('最近 7 天还没有复习记录')}</p>
                <p className="text-xs text-muted/70 mt-1">{t('完成一次复习后，这里会显示每天的复习量')}</p>
              </div>
            ) : (
            <div className="flex-1 flex justify-between gap-2 h-32">
              {chartData.map(d => (
                <div key={d.key} className="flex flex-col items-center gap-2 flex-1 h-full group">
                  <div className="relative w-full flex justify-center flex-1 items-end">
                    {/* 柱子 */}
                    <div 
                      className={`w-full max-w-[24px] rounded-t-sm transition-all duration-500 ${d.count > 0 ? 'bg-primary-500 group-hover:bg-primary-600' : 'bg-app'}`}
                      style={{ height: `${Math.max((d.count / maxChartCount) * 100, 4)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute -top-8 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 text-white text-[10px] py-1 px-2 rounded pointer-events-none whitespace-nowrap">
                      {d.count} {t('张')}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted">{d.label}</span>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* 开始复习 */}
          <div className="bg-card border border-app p-6 rounded-2xl shadow-sm flex flex-col justify-center">
            <h3 className="text-lg font-bold text-main mb-2">{t('开始今天的复习')}</h3>
            <p className="text-xs text-muted mb-6">
              {serverStats.due > 0
                ? t('基于艾宾浩斯遗忘曲线，系统已为你准备好即将遗忘的卡片。')
                : t('当前没有到期的卡片。新建笔记并拆卡后，明天就会出现在这里。')}
            </p>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-main">{t('选择复习范围')}</label>
                <select 
                  value={selectedNote}
                  onChange={e => setSelectedNote(e.target.value)}
                  className="w-full border border-app bg-app text-main p-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer text-sm"
                >
                  <option value="all" className="bg-app text-main">{scoped ? t('本分类里的全部卡片') : t('全部笔记的卡片')}</option>
                  {notes.map(n => (
                    <option key={n.id} value={n.id} className="bg-app text-main">
                      {scoped
                        ? String(n.question || '').slice(0, 26).replace(/\n/g, ' ') + (String(n.question || '').length > 26 ? '…' : '')
                        : n.raw_text.slice(0, 15).replace(/\n/g, ' ') + '... (' + new Date(n.created_at).toLocaleDateString() + ')'}
                    </option>
                  ))}
                </select>
              </div>
              
              <button 
                onClick={startSession}
                disabled={loading || serverStats.due === 0}
                className="w-full py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? t('加载中...') : serverStats.due === 0 ? t('暂无待复习卡片') : t('开始复习')}
              </button>
            </div>
            {err && <p className="text-red-500 text-xs mt-3">{err}</p>}
          </div>
        </div>
      </div>

      {/* 统计卡详情抽屉：挂到 body 上，否则外层 animate-page 的 transform 会把 fixed 的参照系变成那层容器 */}
      {detailModal.mounted && createPortal(
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-6 modal-overlay ${detailModal.closing ? 'closing' : ''}`} onClick={() => setDetail(null)}>
          <div className={`w-full max-w-lg max-h-[70vh] bg-card border border-app rounded-2xl shadow-2xl flex flex-col overflow-hidden modal-panel ${detailModal.closing ? 'closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between p-5 border-b border-app">
              <div>
                <h3 className="font-bold text-main">{t(detail.title)}</h3>
                <p className="text-xs text-muted mt-0.5">
                  {detail.loading ? t('加载中...') : t('共 {n} 张', { n: detail.items.length })}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="p-1.5 hover:bg-app rounded-lg text-muted hover:text-main transition-colors">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detail.error && <p className="text-xs text-red-500">{detail.error}</p>}
              {!detail.loading && !detail.error && detail.items.length === 0 && (
                <p className="text-sm text-muted text-center mt-10">{t('这个分类下还没有卡片')}</p>
              )}
              {detail.items.map(c => (
                <div key={c.id} className="p-3 bg-app border border-app rounded-xl">
                  <p className="text-sm font-medium text-main">{c.question}</p>
                  <p className="text-xs text-muted mt-1 line-clamp-2">{c.answer}</p>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-app">
              <button
                onClick={startExtra}
                disabled={detail.loading || detail.items.length === 0}
                className="w-full py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('加练这 {n} 张', { n: detail.items.length })}
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
}

  // ================= 视图 3：结算战报页 =================
  if (view === 'summary') {
    const currentDetails = detailGrade ? session.details.filter(d => d.grade === detailGrade) : [];
    return (
      <div className="max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto h-[calc(100vh-120px)] flex flex-col items-center justify-center animate-page relative">
        {/* ... (保持原样) ... */}
        <div className="w-24 h-24 rounded-full bg-green-500/10 flex items-center justify-center mb-6 shadow-inner">
          <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
        </div>
        <p className="text-2xl font-bold text-main mb-2">{t('🎉 本轮复习完成！')}</p>
        <p className="text-muted text-sm mb-8">{t('本次复习了 {n} 张卡片', { n: queue.length })}</p>

        <div className="grid grid-cols-4 gap-3 mb-8 max-w-md w-full">
          {GRADE_CONFIG.map((g) => {
            const count = session.details.filter(d => d.grade === g.grade).length || 0;
            return (
              <button key={g.grade} onClick={() => count > 0 && setDetailGrade(g.grade)} disabled={count === 0} className={`px-4 py-3 rounded-xl transition-all duration-200 flex flex-col items-center justify-center ${g.bg} ${g.text} ${count > 0 ? 'hover:scale-105 hover:shadow-md cursor-pointer hover:bg-opacity-20' : 'opacity-50 cursor-default'}`}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-muted mt-1">{t(g.label)}</p>
              </button>
            )
          })}
        </div>

        <button onClick={() => { setView('home'); loadDashboard(); }} className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm">
          {t('返回复习主页')}
        </button>

        {detailGrade && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm fade-in" onClick={() => setDetailGrade(null)}>
            <div className="bg-card w-full max-w-lg max-h-[80vh] rounded-2xl shadow-2xl border border-app flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-app bg-app/50">
                <h3 className="font-bold text-main flex items-center gap-2">{t('明细 ({n})', { n: currentDetails.length })}</h3>
                <button onClick={() => setDetailGrade(null)} className="p-1 hover:bg-app rounded-lg text-muted hover:text-main"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              <div className="p-5 overflow-y-auto space-y-4">
                {currentDetails.map((c, i) => (
                  <div key={`${c.id}-${i}`} className="p-4 bg-app border border-app rounded-xl">
                    <p className="font-medium text-main text-sm mb-2">{c.question}</p>
                    <p className="text-xs text-muted whitespace-pre-wrap">{c.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ================= 视图 2：复习进行中 =================
  const progress = (idx / queue.length) * 100;
  return (
    <div className="max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-5 animate-page">
      {/* ... (保持原样) ... */}
      <div className="flex items-center justify-between">
        <button onClick={() => setView('home')} className="text-sm text-muted hover:text-main flex items-center gap-1 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          {t('结束并返回主页')}
        </button>
      </div>

      <div className="bg-card border border-app rounded-xl px-5 py-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted">{t('本轮进度 · 剩余 {n} 张', { n: queue.length - idx })}</span>
          <span className="text-xs font-bold text-main">{idx + 1} / {queue.length}</span>
        </div>
        <div className="h-1.5 bg-app rounded-full overflow-hidden">
          <div className="h-full bg-primary-600 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="relative bg-card rounded-2xl shadow-lg border border-app p-8 min-h-[360px] flex flex-col transition-all duration-300">
        <div className="absolute top-4 left-4 flex items-center gap-1.5 text-xs text-muted">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          {t('知识卡片')}
        </div>

        <div className="space-y-5 mt-4">
          <div className="text-center">
            <p className="text-xs font-medium text-primary-600 mb-3 tracking-[0.2em] uppercase">Question</p>
            <p className="text-xl md:text-2xl font-semibold text-main leading-relaxed">{card.question}</p>
          </div>

          {!flipped && (
            <div>
              <p className="text-xs text-muted mb-2">{t('先自己写一遍，再对照答案')}</p>
              <textarea
                value={typed}
                readOnly={!!judge?.verdict}
                onChange={(e) => { if (!judge?.verdict) setTyped(e.target.value); }}
                rows={4}
                placeholder={t('用你自己的话回答...')}
                className="w-full bg-app border border-app rounded-xl p-3 text-sm text-main placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y font-app"
              />
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button
                  onClick={submitAnswer}
                  disabled={judge?.loading || typed.trim().length === 0}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {judge?.loading ? t('AI 评判中...') : t('提交作答')}
                </button>
                {judge?.verdict && <span className="text-xs text-muted">{t('已提交，不可修改')}</span>}
                {answerErr && <span className="text-xs text-red-500">{answerErr}</span>}
              </div>
            </div>
          )}

          {flipped && (
            <div className="pt-4 border-t border-app fade-in space-y-4">
              {judge?.verdict && (
                <div className={`rounded-xl border p-3 ${verdictStyle(judge.verdict)}`}>
                  <p className="text-sm font-medium">{verdictLabel(judge.verdict)}</p>
                  {typeof judge.score === 'number' && <span className="ml-2 text-xs opacity-70">{t('得分')} {judge.score}</span>}
                  {judge.comment && <p className="text-xs mt-1 opacity-80">{judge.comment}</p>}
                </div>
              )}
              {typed.trim() && (
                <div>
                  <p className="text-xs font-medium text-muted mb-2 tracking-[0.2em] uppercase">{t('你的作答')}</p>
                  <p className="text-sm text-main leading-relaxed whitespace-pre-wrap bg-app border border-app rounded-lg p-3">{typed}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-primary-600 mb-2 tracking-[0.2em] uppercase">Answer</p>
                <p className="text-base text-muted leading-relaxed whitespace-pre-wrap">{card.answer}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {createPortal(
        <div className="fixed bottom-6 right-6 z-40 fade-in">
          {!flipped ? (
            <button
              onClick={async () => {
                if (!card || autoGraded) return;
                setFlipped(true);
                await api(`/api/cards/${card.id}/review`, { method: 'POST', body: { grade: 'again' } });
                setSession((s2) => ({ done: s2.done + 1, details: [...s2.details, { ...card, grade: 'again' }] }));
                setServerStats((s2) => ({
                  ...s2,
                  due: Math.max(s2.due - 1, 0),
                  todayReviewed: s2.todayReviewed + 1,
                }));
                setAutoGraded(true);
              }}
              className="px-4 py-2.5 bg-card border border-app rounded-xl shadow-lg text-sm font-medium text-main hover:border-primary-500/50 transition-colors"
            >
              {t('直接看答案')}
            </button>
          ) : (
            <div className="flex items-center gap-3 bg-card border border-app rounded-xl shadow-lg px-4 py-3">
              <div className="text-xs text-muted max-w-[220px]">
                {judge?.verdict ? verdictLabel(judge.verdict) : t('已跳过作答，本题记为忘了')}
              </div>
              <button
                onClick={() => {
                  const isLast = idx + 1 >= queue.length;
                  setFlipped(false);
                  setTyped('');
                  setJudge(null);
                  setAutoGraded(false);
                  setAnswerErr('');
                  if (isLast) { setView('summary'); return; }
                  setIdx((i) => i + 1);
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors whitespace-nowrap"
              >
                {idx + 1 >= queue.length ? t('完成本轮') : t('进入下一题')}
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}