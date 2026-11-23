// 复习答题时的专注模式：隐藏左侧导航，防止中途切页
let focused = false;
const listeners = new Set();

export function setFocusMode(next) {
  const v = !!next;
  if (v === focused) return;
  focused = v;
  listeners.forEach((fn) => fn(v));
}

export function getFocusMode() {
  return focused;
}

export function subscribeFocusMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
