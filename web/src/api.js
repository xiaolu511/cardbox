const TOKEN_KEY = 'cardbox_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setToken = (t) => 
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

// 401 的统一出口：App 注册进来后，token 失效会自动清掉并回登录页。
// 之前没有这个钩子，token 过期（换过 JWT 密钥、或 7 天到期）只会抛一行红字，用户卡在页面上不知道怎么办。
let unauthorizedHandler = null;
export const setUnauthorizedHandler = (fn) => { unauthorizedHandler = fn; };

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 带着 token 却被拒 = 凭证过期，清掉并通知上层；
  // 没带 token 的 401 是登录接口自己的错（密码错误），保留原来的错误文案
  if (res.status === 401 && token) {
    setToken(null);
    if (unauthorizedHandler) unauthorizedHandler();
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}
