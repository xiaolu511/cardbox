// 版本检查的公共逻辑：关于页的「检查更新」和启动时的静默检查都用这一份。
export const CURRENT_VERSION = __APP_VERSION__;
export const RELEASE_REPO = 'xiaolu511/cardbox';

// 按段比数字：1.0.10 > 1.0.9（字符串比较会判反），返回 1 / 0 / -1
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// 先问本地服务端（它带 10 分钟缓存），失败再直连 GitHub。
// 为什么要两条路：部分机器上 Node 的证书链验不过 GitHub（unable to verify the first certificate），
// 而 Chromium 走 Windows 系统证书库是通的，所以兜底直连反而能成功。
export async function fetchLatestRelease(signal) {
  try {
    const res = await fetch('/api/version', { signal });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.latestVersion) return data;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  const res = await fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
    signal,
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
  const rel = await res.json();
  return {
    latestVersion: String(rel.tag_name || '').replace(/^v/i, ''),
    releaseNotes: rel.body || '',
    downloadUrl: rel.html_url,
  };
}

// 启动时的静默检查：只回答「有没有比我新的」，任何错误都当没有，不打扰用户。
export async function checkForUpdateSilently() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const data = await fetchLatestRelease(ctrl.signal);
    const latest = String(data?.latestVersion || '');
    if (!latest) return null;
    return compareVersions(latest, CURRENT_VERSION) > 0
      ? { latestVersion: latest, downloadUrl: data.downloadUrl || '' }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
