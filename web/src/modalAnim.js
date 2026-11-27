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

// 弹窗退场时，触发它打开的数据可能已经被清空（例如 setDetail(null)）。
// 这里把最后一次非空值留住，避免退场那一帧去读 null 的字段。
export function useHeld(value) {
  const [held, setHeld] = useState(value);
  if (value != null && value !== held) setHeld(value);
  return value == null ? held : value;
}
