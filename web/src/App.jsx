import { useState } from 'react';
import { getToken, setToken } from './api';
import LoginPage from './pages/LoginPage';
import NotesPage from './pages/NotesPage';
import CardsPage from './pages/CardsPage';
import ReviewPage from './pages/ReviewPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [token, _setToken] = useState(getToken());
  const [tab, setTab] = useState('notes'); // 'notes', 'cards', 'review' 或 'settings'

  if (!token) {
    return <LoginPage onLogin={(t) => { setToken(t); _setToken(t); }} />;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <header className="flex items-center gap-6 mb-6 border-b pb-4">
        <h1 className="text-xl font-bold">Cardbox</h1>
        
        <div className="flex gap-4 text-sm">
          <button 
            onClick={() => setTab('notes')} 
            className={tab === 'notes' ? 'font-bold text-blue-600' : 'text-gray-500 hover:text-black'}
          >
            笔记
          </button>
          <button 
            onClick={() => setTab('cards')} 
            className={tab === 'cards' ? 'font-bold text-blue-600' : 'text-gray-500 hover:text-black'}
          >
            卡片
          </button>
          <button 
            onClick={() => setTab('review')} 
            className={tab === 'review' ? 'font-bold text-blue-600' : 'text-gray-500 hover:text-black'}
          >
            复习
          </button>
          <button 
            onClick={() => setTab('settings')} 
            className={tab === 'settings' ? 'font-bold text-blue-600' : 'text-gray-500 hover:text-black'}
          >
            设置
          </button>
        </div>

        <button 
          onClick={() => { setToken(null); _setToken(null); }} 
          className="ml-auto text-sm text-red-500 hover:underline"
        >
          登出
        </button>
      </header>

      {tab === 'notes' && <NotesPage />}
      {tab === 'cards' && <CardsPage />}
      {tab === 'review' && <ReviewPage />}
      {tab === 'settings' && <SettingsPage />}
    </div>
  );
}