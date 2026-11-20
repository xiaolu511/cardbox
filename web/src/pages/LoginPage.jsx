import { useState } from 'react';
import { api } from '../api';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr('');
    try {
      const { token } = await api(`/api/auth/${mode}`, { method: 'POST', body: { email, password } });
      onLogin(token);
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="max-w-sm mx-auto mt-24 p-6 border rounded shadow-sm space-y-4">
      <h1 className="text-xl font-bold">Cardbox</h1>
      <p className="text-sm text-gray-500">{mode === 'login' ? '登录' : '注册新账号'}</p>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border p-2 rounded" />
        <input type="password" required minLength={6} placeholder="密码（≥6 位）" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border p-2 rounded" />
        {err && <p className="text-red-500 text-sm">{err}</p>}
        <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">{mode === 'login' ? '登录' : '注册'}</button>
      </form>
      <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-sm text-blue-600 hover:underline">
        {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
      </button>
    </div>
  );
}