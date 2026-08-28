const foundations = [
  ['M1', 'Next.js 15 / TypeScript / CI'],
  ['M2', 'Supabase Postgres / Drizzle schema'],
  ['M3', 'Job queue / ephemeral workspace'],
] as const;

export default function HomePage() {
  return (
    <main className="shell">
      <p className="eyebrow">Machiwhale Studio · Shared Workspace</p>
      <h1>AI Founder Signals</h1>
      <p className="lede">
        AI 创始人一手访谈探测器。产品 Feed 将在 M5 接入；当前页面只用于验证工程地基。
      </p>
      <section aria-label="工程地基" className="foundation-grid">
        {foundations.map(([module, label]) => (
          <article className="foundation-card" key={module}>
            <span>{module}</span>
            <strong>{label}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
