// 跨组件的「拖进来的文件」通道：App 负责接收拖拽并解析，笔记页负责接收正文
let handler = null;

export function onDropFile(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}

export function emitDropFile(payload) {
  if (handler) handler(payload);
}
