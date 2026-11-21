// 头像内置进包里：原来指向 github.com/xiaolu511.png，离线或被墙时关于页会变裂图，
// 而且每次打开都要多一次网络请求。这张是 200px 版本（74KB）。
import avatarUrl from '../assets/avatar.png';

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto animate-page">
      <div className="bg-card rounded-2xl shadow-sm border border-app overflow-hidden transition-colors duration-300">
        
        {/* 头部横幅区 */}
        <div className="h-32 bg-primary-600/10 flex items-end justify-center relative">
           {/* 也可以在这里放一张你喜欢的背景图 */}
        </div>

        {/* 软件信息区 */}
        <div className="px-8 pb-8 relative flex flex-col items-center">
          {/* Logo (悬浮在横幅上) */}
          <div className="w-20 h-20 bg-primary-600 rounded-2xl shadow-lg flex items-center justify-center -mt-10 mb-4 transform hover:scale-105 transition-transform duration-300">
            <span className="text-4xl text-white font-bold">C</span>
          </div>
          
          <h1 className="text-2xl font-bold text-main">Cardbox</h1>
          <p className="text-sm text-primary-600 font-medium mt-1">v{__APP_VERSION__}</p>
          <p className="text-muted text-sm mt-3 text-center max-w-md">
            一款基于 AI 的智能知识卡片笔记软件。将长文本一键提炼为问答卡片，结合间隔重复算法，让你的学习效率翻倍。
          </p>

          <div className="mt-6 flex gap-3">
            <a 
              href="https://github.com/xiaolu511" 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-app border border-app text-main rounded-lg text-sm font-medium hover-item transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" /></svg>
              GitHub 主页
            </a>
          </div>
        </div>

        {/* 分割线 */}
        <div className="border-t border-app"></div>

        {/* 详情信息区 */}
        <div className="p-8 space-y-8">
          
          {/* 技术栈 */}
          <div>
            <h3 className="text-sm font-bold text-main mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
              技术栈
            </h3>
            <div className="flex flex-wrap gap-2">
              {['React', 'Fastify', 'SQLite (FTS5)', 'TailwindCSS', 'Electron', 'DeepSeek AI', 'Zod'].map(tech => (
                <span key={tech} className="px-3 py-1 bg-app border border-app rounded-md text-xs font-medium text-muted">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* 开发者 */}
          <div>
            <h3 className="text-sm font-bold text-main mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
              开发者
            </h3>
              <div className="flex items-center gap-4 p-4 bg-app border border-app rounded-xl">
              <img 
                src={avatarUrl} 
                alt="xiaolu511" 
                className="w-12 h-12 rounded-full border border-app shadow-sm object-cover bg-white"
              />
              <div>
                <p className="font-bold text-main text-sm">xiaolu511</p>
                <p className="text-xs text-muted mt-0.5">全栈独立开发者</p>
                <p className="text-xs text-muted mt-0.5">联系邮箱: 2902338992@qq.com</p>
              </div>
            </div>
          </div>

          {/* 底部版权 */}
          <div className="pt-4 text-center">
            <p className="text-xs text-muted">
              © {new Date().getFullYear()} Cardbox. Built with ❤️ and AI.
            </p>
            <p className="text-xs text-muted mt-1">
              本软件基于 MIT 协议开源。
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}