// AI 判定严格度：三档，存本机，提交作答时带给后端
const KEY = 'cardbox-judge-strictness';

export const STRICTNESS_OPTIONS = [
  { id: 'strict', label: '严格' },
  { id: 'normal', label: '适中' },
  { id: 'loose', label: '宽松' },
];

export function getStrictness() {
  const v = localStorage.getItem(KEY);
  return ['strict', 'normal', 'loose'].includes(v) ? v : 'normal';
}

export function setStrictness(v) {
  if (!['strict', 'normal', 'loose'].includes(v)) return;
  localStorage.setItem(KEY, v);
}
