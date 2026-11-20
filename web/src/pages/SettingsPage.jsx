import { useState, useEffect } from 'react';
import { api } from '../api';

export default function SettingsPage() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState({ hasKey: false, maskedKey: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/api/settings').then(setStatus).catch(console.error);
  }, []);

  async function save(e) {
    e.preventDefault();
    setMsg('');
    try {
      await api('/api/settings', { method: 'POST', body: { api_key: key } });
      setMsg('✅ 保存成功！现在可以去拆卡了。');
      setKey('');
      const newStatus = await api('/api/settings');
      setStatus(newStatus);
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">系统设置</h2>
      <div className="bg-gray-50 border p-4 rounded text-sm text-gray-700">
        <p>当前状态：{status.hasKey ? `已配置 (${status.maskedKey})` : '未配置 API Key'}</p>
        <p className="mt-2 text-xs text-gray-500">
          请前往 <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-blue-600 underline">DeepSeek 开放平台</a> 注册并获取 API Key。
        </p>
      </div>

      <form onSubmit={save} className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="输入 sk- 开头的 API Key"
          className="flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
      </form>
      {msg && <p className={msg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}>{msg}</p>}
    </div>
  );
}