// 弹窗的进出场：关闭时先留在 DOM 里播完退场动画，再卸载。
// 返回 mounted（是否渲染）和 closing（是否正在退场）。
import { useEffect, useState } from 'react';

const DURATION = 180;

export function useModalPresence(open, duration = DURATION) {
  const [mounted, setMounted] = useState(!!open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setClosing(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, duration);
    return () => clearTimeout(timer);
  }, [open, mounted, duration]);

  return { mounted: mounted || !!open, closing };
}
