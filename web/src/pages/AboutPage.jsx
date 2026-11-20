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
              className="px-4 py-2 bg-app border border-app text-main rounded-lg text-sm font-medium hover-item transition-colors"
            >
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
              <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-xl shadow-sm">
                X
              </div>
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