/**
 * 加载骨架。
 *
 * App Router 的 streaming：有这个文件，外壳会**立刻**渲染，
 * 数据在后面流过来。没有它，整页要等 loadFeed 返回才吐第一个字节。
 *
 * 这不只是好看——快捷指令启动时，脚本可以一见到端口接受连接就开浏览器，
 * 不必干等数据就绪。用户原话：「先弹出页面，并显示"数据还在加载"，
 * 而不是等数据加载完之后再把页面弹出。」
 */
export default function Loading() {
  return (
    <main className="feed-shell" aria-busy="true" aria-live="polite">
      <div className="masthead">
        <div className="masthead-topline">
          <span className="brand-stamp">AFS</span>
          <span>创始人一手访谈 · 晨间信号台</span>
          <span>{' '}</span>
        </div>
        <div className="masthead-rule" />
        <div className="masthead-main">
          <p className="overline">MACHIWHALE INTELLIGENCE DESK</p>
          <h1>
            AI Founder
            <em>Signals</em>
          </h1>
          <p className="skeleton-note">正在读取今天的信号…</p>
        </div>
      </div>

      <section className="skeleton-stream" aria-label="内容加载中">
        {[0, 1, 2].map((i) => (
          <article className="skeleton-card" key={i}>
            <div className="skeleton-line skeleton-line--badge" />
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--meta" />
            <div className="skeleton-block" />
          </article>
        ))}
      </section>
    </main>
  );
}
