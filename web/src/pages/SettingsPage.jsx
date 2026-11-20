import { useState, useEffect } from 'react';
import { api } from '../api';

export default function SettingsPage() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState({ hasKey: false, maskedKey: '' });
  const [msg, setMsg] = useState('');
  
  const [theme, setTheme] = useState(localStorage.getItem('cardbox-theme') || 'blue');

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

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('cardbox-theme', newTheme);
    if (newTheme === 'blue') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', newTheme);
  };

  return (
    <div className="space-y-8">
      {/* API Key 配置区 */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold">系统设置</h2>
        <div className="bg-gray-50 border p-4 rounded text-sm text-gray-700">
          <p>当前状态：{status.hasKey ? `已配置 (${status.maskedKey})` : '未配置 API Key'}</p>
          <p className="mt-2 text-xs text-gray-500">
            请前往 <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-primary-600 underline">DeepSeek 开放平台</a> 注册并获取 API Key。
          </p>
        </div>

        <form onSubmit={save} className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="输入 sk- 开头的 API Key"
            className="flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors">保存</button>
        </form>
        {msg && <p className={msg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}>{msg}</p>}
      </div>

      {/* 🌟 新增：主题换肤区 */}
      <div className="pt-6 border-t border-gray-200 space-y-4">
        <h3 className="text-md font-bold">界面主题</h3>
        <p className="text-sm text-gray-500">选择你喜欢的软件强调色</p>
        
        <div className="flex gap-4">
          {[
            { id: 'blue', name: '默认蓝', color: '#2563eb' },
            { id: 'purple', name: '葡萄紫', color: '#9333ea' },
            { id: 'green', name: '翡翠绿', color: '#16a34a' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => changeTheme(t.id)}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-all ${
                theme === t.id 
                  ? 'border-primary-500 bg-primary-50 text-primary-700 ring-2 ring-primary-200' 
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}