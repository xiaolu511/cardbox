import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 切换动画：记住上一次的顺序，算出方向。
 * axis='x' 用于横向并排的标签/按钮，axis='y' 用于纵向列表。
 * 返回的 class 挂在内容根上，同时用 key={current} 让内容重新挂载，动画才会重跑。
 */
export function useSwitchClass(current, order, axis = 'x') {
  const prevRef = useRef(current);
  const [cls, setCls] = useState('');

  // 用 layout effect：绘制前就把方向类挂上，避免先闪一帧无动画
  useLayoutEffect(() => {
    const prev = prevRef.current;
    if (prev === current) return;
    const a = order.indexOf(prev);
    const b = order.indexOf(current);
    const forward = a === -1 || b === -1 ? true : b > a;
    const dir = axis === 'x'
      ? (forward ? 'switch-x-f' : 'switch-x-b')
      : (forward ? 'switch-y-f' : 'switch-y-b');
    setCls(dir);
    prevRef.current = current;
  }, [current, order, axis]);

  return cls;
}
