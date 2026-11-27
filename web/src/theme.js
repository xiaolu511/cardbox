// 主题变量的唯一入口。
// 踩过的坑：原来 App.jsx 挂载时设 8 个 CSS 变量，而 SettingsPage.applyTheme 只设 6 个
// （漏了 text-muted / hover / primary-bg / primary-text），于是运行时切预设只改一半，
// 必须刷新才恢复正常。现在两边都调这里的 applyTheme，变量清单只维护一份。

export const THEME_DEFAULTS = {
  primary: '#2563eb',
  bg: '#f8fafc',
  sidebar: '#ffffff',
  card: '#ffffff',
  fontSize: '16px',
  fontFamily: '系统默认',
  bgOpacity: 60,         // 背景图不透明度（%）：第一层，越低壁纸越淡
  panelOpacity: 100,     // 面板不透明度（%）：第二层左栏 + 第三层主体
  backgroundImage: '',   // 背景图 dataURL，空 = 纯色
};

// 系统默认字体栈：Windows 落微软雅黑、macOS 落苹方，避免中文到处不一样
export const DEFAULT_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

const KEYS = {
  primary: 'cardbox-primary',
  bg: 'cardbox-bg',
  sidebar: 'cardbox-sidebar',
  card: 'cardbox-card',
  fontSize: 'cardbox-fontsize',
  fontFamily: 'cardbox-fontfamily',
  customFont: 'cardbox-customfont',
  panelOpacity: 'cardbox-opacity',   // 沿用旧键，老用户的面板值不会丢
  bgOpacity: 'cardbox-bgopacity',
  backgroundImage: 'cardbox-bgimage',
};

const read = (key, fallback) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

export function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#1e293b' : '#f8fafc';
}

export function readTheme() {
  return {
    primary: read(KEYS.primary, THEME_DEFAULTS.primary),
    bg: read(KEYS.bg, THEME_DEFAULTS.bg),
    sidebar: read(KEYS.sidebar, THEME_DEFAULTS.sidebar),
    card: read(KEYS.card, THEME_DEFAULTS.card),
    fontSize: read(KEYS.fontSize, THEME_DEFAULTS.fontSize),
    fontFamily: read(KEYS.fontFamily, THEME_DEFAULTS.fontFamily),
    panelOpacity: Number(read(KEYS.panelOpacity, THEME_DEFAULTS.panelOpacity)) || 100,
    bgOpacity: Number(read(KEYS.bgOpacity, THEME_DEFAULTS.bgOpacity)) || 60,
    backgroundImage: read(KEYS.backgroundImage, ''),
  };
}

export function saveTheme(theme) {
  const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* 配额满不阻断主题生效 */ }
  };
  write(KEYS.primary, theme.primary);
  write(KEYS.bg, theme.bg);
  write(KEYS.sidebar, theme.sidebar);
  write(KEYS.card, theme.card);
  write(KEYS.fontSize, theme.fontSize);
  write(KEYS.fontFamily, theme.fontFamily);
  write(KEYS.panelOpacity, String(theme.panelOpacity ?? THEME_DEFAULTS.panelOpacity));
  write(KEYS.bgOpacity, String(theme.bgOpacity ?? THEME_DEFAULTS.bgOpacity));
  write(KEYS.backgroundImage, theme.backgroundImage || '');
}

export function fontFamilyToCss(fontFamily) {
  if (!fontFamily || fontFamily === THEME_DEFAULTS.fontFamily) return DEFAULT_FONT_STACK;
  return `'${fontFamily}', ${DEFAULT_FONT_STACK}`;
}

// 一次把全部变量刷到 :root —— 这是修「切主题只改一半」的地方
export function applyTheme(theme) {
  const { primary, bg, sidebar, card, fontSize, fontFamily } = theme;
  const panelOpacity = Math.min(100, Math.max(20, Number(theme.panelOpacity) || 100));
  const bgOpacity = Math.min(100, Math.max(0, Number(theme.bgOpacity) ?? 60));
  const style = document.documentElement.style;
  const isDark = getContrastColor(bg) === '#f8fafc';

  style.setProperty('--custom-primary', primary);
  // 第一层是底色；壁纸单独铺在它上面（body::before），所以底色保持实心
  style.setProperty('--custom-bg', bg);
  // 第二/三层（左栏 + 主体）半透明：低于 100% 时掺透明，壁纸才能透出来
  const alpha = (hex) => (panelOpacity >= 100 ? hex : `color-mix(in srgb, ${hex} ${panelOpacity}%, transparent)`);
  style.setProperty('--custom-sidebar', alpha(sidebar));
  style.setProperty('--custom-card', alpha(card));
  style.setProperty('--custom-text', isDark ? '#f8fafc' : '#1e293b');
  style.setProperty('--custom-text-muted', isDark ? '#94a3b8' : '#64748b');
  style.setProperty('--custom-border', isDark ? '#334155' : '#e2e8f0');
  style.setProperty('--custom-hover', isDark ? '#334155' : '#f1f5f9');
  style.setProperty(
    '--custom-primary-bg',
    isDark
      ? `color-mix(in srgb, ${primary} 25%, transparent)`
      : `color-mix(in srgb, ${primary} 10%, white)`
  );
  style.setProperty(
    '--custom-primary-text',
    isDark ? primary : `color-mix(in srgb, ${primary} 80%, black)`
  );
  style.setProperty('--app-font-size', fontSize);
  // 壁纸铺在 body::before 上，靠 --custom-bg-opacity 控制它自己的不透明度
  style.setProperty('--custom-bg-image', theme.backgroundImage ? `url(${theme.backgroundImage})` : 'none');
  style.setProperty('--custom-bg-opacity', bgOpacity / 100);
  style.setProperty('--app-font-family', fontFamilyToCss(fontFamily));
}

// 一键恢复默认外观：清掉自定义字体（含已注入的 @font-face）再写回默认值
export function resetTheme() {
  try {
    localStorage.removeItem(KEYS.customFont);
    localStorage.removeItem(KEYS.fontFamily);
  } catch { /* 存不了也不影响生效 */ }
  document.getElementById('cardbox-custom-font')?.remove();
  saveTheme(THEME_DEFAULTS);
  applyTheme(THEME_DEFAULTS);
}

// 自定义字体以 base64 存在 localStorage，刷新后要重新注入 @font-face，否则下次启动就丢
export function ensureCustomFont() {
  const name = read(KEYS.fontFamily, '');
  const dataUrl = read(KEYS.customFont, '');
  if (!name || name === THEME_DEFAULTS.fontFamily || !dataUrl) return;
  if (document.getElementById('cardbox-custom-font')) return;
  const el = document.createElement('style');
  el.id = 'cardbox-custom-font';
  el.textContent = `@font-face { font-family: '${name}'; src: url(${dataUrl}); }`;
  document.head.appendChild(el);
}

// 导入字体：返回 {ok, error}，把「配额满」变成看得见的话而不是静默失败
export function importCustomFont(file, onDone) {
  const reader = new FileReader();
  reader.onerror = () => onDone({ ok: false, error: '读取字体文件失败' });
  reader.onload = (event) => {
    const dataUrl = event.target.result;
    const name = file.name.replace(/\.[^/.]+$/, '');
    try {
      localStorage.setItem(KEYS.customFont, dataUrl);
      localStorage.setItem(KEYS.fontFamily, name);
    } catch {
      onDone({ ok: false, error: '字体太大，浏览器存储放不下（建议 2MB 以内）' });
      return;
    }
    document.getElementById('cardbox-custom-font')?.remove();
    const el = document.createElement('style');
    el.id = 'cardbox-custom-font';
    el.textContent = `@font-face { font-family: '${name}'; src: url(${dataUrl}); }`;
    document.head.appendChild(el);
    onDone({ ok: true, name });
  };
  reader.readAsDataURL(file);
}
