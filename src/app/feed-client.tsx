'use client';

import {
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
} from 'react';
import { applyFeedAction } from './actions';
import {
  applyLocalFeedAction,
  EMPTY_FILTERS,
  feedOptions,
  feedStats,
  splitFeed,
} from '../feed/model';
import type {
  FeedFilters,
  FeedItemAction,
  FeedItemView,
  FeedMediaType,
  FeedPayload,
  FeedRegion,
} from '../feed/types';

const mediaLabels: Record<FeedMediaType, string> = {
  article: '文章',
  video: '视频',
  podcast: '播客',
};

const mediaMarks: Record<FeedMediaType, string> = {
  article: 'TXT',
  video: 'VID',
  podcast: 'AUD',
};

type FeedSkin = 'editorial' | 'aurora';

const skinStorageKey = 'afs-feed-skin';

function getSkinSnapshot(): FeedSkin {
  if (typeof document === 'undefined') return 'editorial';
  return document.documentElement.dataset.skin === 'aurora' ? 'aurora' : 'editorial';
}

function subscribeToSkin(onStoreChange: () => void) {
  window.addEventListener('afs-skin-change', onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    window.removeEventListener('afs-skin-change', onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

export function FeedClient({ payload }: { payload: FeedPayload }) {
  const [items, dispatch] = useReducer(applyLocalFeedAction, payload.items);
  const [filters, setFilters] = useState<FeedFilters>(EMPTY_FILTERS);
  const [notice, setNotice] = useState('');
  const [isPending, startTransition] = useTransition();
  const options = useMemo(() => feedOptions(items), [items]);
  const stats = useMemo(() => feedStats(items), [items]);
  const { visible, folded } = useMemo(() => splitFeed(items, filters), [items, filters]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const generatedAt = new Date(payload.generatedAt);

  const updateFilter = <Key extends keyof FeedFilters>(key: Key, value: FeedFilters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const act = (action: FeedItemAction, successMessage: string) => {
    dispatch(action);
    setNotice(successMessage);
    startTransition(async () => {
      const result = await applyFeedAction(action);
      if (!result.ok) setNotice('状态已在本页更新，但写库失败；稍后可重试');
      else if (!result.persisted) setNotice(`${successMessage} · 当前为安全预览，尚未写库`);
      else setNotice(`${successMessage} · 已写入`);
    });
  };

  const actionAt = () => new Date().toISOString();

  return (
    <main className="feed-shell">
      <header className="masthead">
        <div className="masthead-rule" aria-hidden="true" />
        <div className="masthead-topline glass">
          <div className="brand-stamp">
            <span className="stamp">AFS</span>
            <small>05 / DAILY</small>
          </div>
          <p>创始人一手访谈 · 晨间信号台</p>
          <div className="masthead-tools">
            <SkinSwitcher />
            <time dateTime={payload.generatedAt}>
              {generatedAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}
            </time>
          </div>
        </div>

        <div className="masthead-main">
          <div>
            <p className="overline">Machiwhale Intelligence Desk</p>
            <h1>AI Founder<br /><em>Signals</em></h1>
          </div>
          <div className="briefing-note glass">
            <span className="briefing-index">今日简报</span>
            <p>先看新面孔与密集发声，再决定哪一场值得带走。</p>
            <small title={payload.notice}>更新 {generatedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {payload.mode === 'demo' ? '演示数据' : '数据库实时'}</small>
          </div>
        </div>

        <dl className="signal-metrics glass" aria-label="Feed 概览">
          <Metric label="全部信号" value={stats.total} />
          <Metric label="尚未读过" value={stats.unread} accent />
          <Metric label="高亮访谈" value={stats.highlights} />
          <Metric label="已标深看" value={stats.queued} />
        </dl>
      </header>

      <section className="filter-deck glass" aria-label="Feed 筛选">
        <div className="filter-deck-heading">
          <span className="filter-number deck-number">01</span>
          <div>
            <strong>缩短信号面</strong>
            <small>{activeFilters ? `已启用 ${activeFilters} 项筛选` : '默认：未读优先 · 最新在前'}</small>
          </div>
        </div>
        <div className="filter-grid">
          <FilterSelect label="人物" value={filters.person} onChange={(value) => updateFilter('person', value)} options={options.persons} />
          <FilterSelect label="公司" value={filters.company} onChange={(value) => updateFilter('company', value)} options={options.companies} />
          <FilterSelect label="媒体" value={filters.source} onChange={(value) => updateFilter('source', value)} options={options.sources} />
          <FilterSelect label="标签" value={filters.tag} onChange={(value) => updateFilter('tag', value)} options={options.tags} />
          <FilterSelect<FeedRegion> label="地区" value={filters.region} onChange={(value) => updateFilter('region', value)} options={['国内', '海外']} />
          <FilterSelect<FeedMediaType> label="类型" value={filters.mediaType} onChange={(value) => updateFilter('mediaType', value)} options={['article', 'video', 'podcast']} optionLabel={(value) => mediaLabels[value]} />
        </div>
        <button
          className="clear-filters"
          type="button"
          disabled={activeFilters === 0}
          onClick={() => setFilters(EMPTY_FILTERS)}
        >
          清除筛选 <span aria-hidden="true">↺</span>
        </button>
      </section>

      <div className="feed-layout">
        <aside className="reading-rail" aria-label="阅读提示">
          <div className="rail-block glass">
            <span className="rail-index deck-number rail">02</span>
            <strong>扫读顺序</strong>
            <ol>
              <li>事实与角标</li>
              <li>AI 摘要</li>
              <li>决定动作</li>
            </ol>
          </div>
          <div className="legend glass">
            <span><i className="dot unread" />未读</span>
            <span><i className="dot highlight" />高亮</span>
            <span><i className="dot read" />已读</span>
          </div>
          <p className="rail-goal">目标：30 秒扫完今天的新信号。</p>
        </aside>

        <section className="signal-stream" aria-labelledby="stream-title">
          <div className="stream-heading">
            <div>
              <span className="section-kicker">02 / SIGNAL STREAM</span>
              <h2 id="stream-title">值得先看的</h2>
            </div>
            <span className="result-count">{visible.length.toString().padStart(2, '0')} 条</span>
          </div>

          {visible.length > 0 ? (
            <div className="cards">
              {visible.map((item, index) => (
                <SignalCard
                  item={item}
                  index={index}
                  key={item.id}
                  onTag={(tag) => updateFilter('tag', tag)}
                  onAction={act}
                  actionAt={actionAt}
                  pending={isPending}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state glass">
              <span>∅</span>
              <h3>这组条件下没有信号</h3>
              <p>清除一两个筛选，信号面会重新展开。</p>
              <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>查看全部</button>
            </div>
          )}

          <details className="folded-drawer glass">
            <summary>
              <span className="folded-mark" aria-hidden="true">↓</span>
              <span>
                <strong>还有 {folded.length} 条低分内容</strong>
                <small>没有丢弃，只是折叠。展开后仍可恢复高亮。</small>
              </span>
              <span className="folded-action">展开查看</span>
            </summary>
            <div className="folded-list">
              {folded.length > 0 ? folded.map((item) => (
                <FoldedRow
                  item={item}
                  key={item.id}
                  onAction={act}
                  actionAt={actionAt}
                />
              )) : <p className="folded-empty">当前筛选下没有低分内容。</p>}
            </div>
          </details>
        </section>
      </div>

      <footer className="feed-footer">
        <div className="footer-main">
          <p><span>AFS</span> 只负责发现；判断与深读仍由 Alice 完成。</p>
          <small>Raw material never leaves the worker.</small>
        </div>
        <small className="footer-copyright">
          © {generatedAt.getFullYear()}{' '}
          <a
            href="https://www.machiwhale.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="访问 Machiwhale Studio 官网（新窗口）"
          >Machiwhale Studio</a>
        </small>
      </footer>

      <div className={`toast ${notice ? 'is-visible' : ''}`} role="status" aria-live="polite">
        <span className={`toast-dot ${isPending ? 'toast-pulse pulse' : ''}`} aria-hidden="true" />
        {notice}
        {notice && <button type="button" onClick={() => setNotice('')} aria-label="关闭状态提示">×</button>}
      </div>
    </main>
  );
}

function SkinSwitcher() {
  const skin = useSyncExternalStore(subscribeToSkin, getSkinSnapshot, () => 'editorial');

  const selectSkin = (nextSkin: FeedSkin) => {
    document.documentElement.dataset.skin = nextSkin;
    try {
      window.localStorage.setItem(skinStorageKey, nextSkin);
    } catch {
      // The selected skin still applies for this page when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent('afs-skin-change', { detail: nextSkin }));
  };

  return (
    <div className="skin-switcher" role="group" aria-label="界面皮肤">
      <span>皮肤</span>
      <button
        type="button"
        aria-label="切换到复古编辑台皮肤"
        aria-pressed={skin === 'editorial'}
        onClick={() => selectSkin('editorial')}
      >复古</button>
      <button
        type="button"
        aria-label="切换到现代极光皮肤"
        aria-pressed={skin === 'aurora'}
        onClick={() => selectSkin('aurora')}
      >极光</button>
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={accent ? 'metric accent' : 'metric'}>
      <dt>{label}</dt>
      <dd>{String(value).padStart(2, '0')}</dd>
    </div>
  );
}

function FilterSelect<Value extends string = string>({
  label,
  value,
  options,
  onChange,
  optionLabel,
}: {
  label: string;
  value: '' | Value;
  options: readonly Value[];
  onChange: (value: '' | Value) => void;
  optionLabel?: (value: Value) => string;
}) {
  return (
    <label className="filter-control">
      <span>{label}</span>
      <select className={value ? 'has-value' : ''} value={value} onChange={(event) => onChange(event.target.value as '' | Value)}>
        <option value="">全部</option>
        {options.map((option) => <option value={option} key={option}>{optionLabel?.(option) ?? option}</option>)}
      </select>
    </label>
  );
}

function SignalCard({
  item,
  index,
  onTag,
  onAction,
  actionAt,
  pending,
}: {
  item: FeedItemView;
  index: number;
  onTag: (tag: string) => void;
  onAction: (action: FeedItemAction, message: string) => void;
  actionAt: () => string;
  pending: boolean;
}) {
  const entityNames = [...item.persons, ...item.companies];
  const meta = factLine(item);

  return (
    <article
      className={`signal-card tone-${item.coverTone} tier-${item.tier} ${item.readAt ? 'is-read' : 'is-unread'}`}
      style={{ '--card-index': index } as CSSProperties}
    >
      <div className="card-sequence card-seq" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
      <div className="card-cover" aria-hidden="true" style={coverStyle(item)}>
        <span className="cover-format">{mediaMarks[item.mediaType]}</span>
        <strong>{coverMonogram(item)}</strong>
        <small>{item.region === '国内' ? 'CN SIGNAL' : 'GLOBAL SIGNAL'}</small>
      </div>

      <div className="card-content">
        <div className="badge-row">
          {item.tier === 'highlight' && <span className="badge badge-highlight">◆ 高亮信号</span>}
          {item.monthlyMention && <span className="badge badge-heat">🔥 {item.monthlyMention.name} 本月第 {item.monthlyMention.count} 场</span>}
          {item.isNewEntity && <span className="badge badge-new">🆕 首次出现</span>}
          {!item.readAt && <span className="unread-label">未读</span>}
        </div>

        <a className="card-title" href={item.url} target="_blank" rel="noreferrer" onClick={() => onAction({ type: 'opened_source', itemId: item.id, at: actionAt() }, '已记录打开原文')}>
          <h3>{item.title}</h3>
        </a>

        <div className="entity-line">
          <p>{entityNames.length ? entityNames.join(' · ') : '尚未识别人物或公司'} <span>/</span> {item.sourceName}</p>
          <div className="entity-stars" aria-label="关注人物或公司">
            {item.entities.map((entity) => (
              <button
                type="button"
                key={`${entity.kind}:${entity.name}`}
                aria-label={`${entity.starred ? '取消关注' : '关注'}${entity.name}`}
                aria-pressed={entity.starred}
                title={`${entity.starred ? '取消关注' : '关注'} ${entity.name}`}
                onClick={() => onAction({
                  type: 'toggle_entity_star',
                  itemId: item.id,
                  entityId: entity.id,
                  entityName: entity.name,
                  entityKind: entity.kind,
                  starred: !entity.starred,
                  at: actionAt(),
                }, entity.starred ? `已取消关注 ${entity.name}` : `已关注 ${entity.name}`)}
              >
                {entity.starred ? '★' : '☆'}
              </button>
            ))}
          </div>
        </div>

        <p className="fact-line">{meta.map((fact) => <span key={fact}>{fact}</span>)}</p>

        <section className={`ai-summary ${item.summary ? '' : 'is-empty'}`} aria-label="AI 摘要">
          <div className="summary-label">
            <span>🤖 AI 摘要</span>
            <small>{item.summary ? 'MODEL SYNTHESIS' : '暂未生成'}</small>
          </div>
          <p>{item.summary ?? emptySummary(item)}</p>
        </section>

        {item.tags.length > 0 && (
          <div className="tag-list" aria-label="主题标签">
            {item.tags.map((tag) => <button type="button" key={tag} onClick={() => onTag(tag)}>#{tag}</button>)}
          </div>
        )}

        <div className="card-actions">
          <a href={item.url} target="_blank" rel="noreferrer" onClick={() => onAction({ type: 'opened_source', itemId: item.id, at: actionAt() }, '已记录打开原文')}>
            <span aria-hidden="true">↗</span> 看原文
          </a>
          <button
            type="button"
            className={item.archiveRequestedAt ? 'is-active' : ''}
            disabled={Boolean(item.archiveRequestedAt)}
            onClick={() => onAction({ type: 'archive_requested', itemId: item.id, at: actionAt() }, '已加入深看队列')}
          >
            <span aria-hidden="true">{item.archiveRequestedAt ? '✓' : '◇'}</span> {item.archiveRequestedAt ? '已标深看' : '深看'}
          </button>
          <span className="action-spacer" />
          <button
            type="button"
            className={`icon-action ${item.tier === 'highlight' ? 'is-active' : ''}`}
            aria-label={item.tier === 'highlight' ? '取消好内容标记' : '这是好内容，置为高亮'}
            aria-pressed={item.tier === 'highlight'}
            title={item.tier === 'highlight' ? '取消好内容标记' : '好内容'}
            disabled={pending}
            onClick={() => {
              const highlighted = item.tier !== 'highlight';
              onAction(
                { type: 'set_highlight', itemId: item.id, highlighted, at: actionAt() },
                highlighted ? '已置为高亮' : '已取消高亮',
              );
            }}
          ><span className="action-glyph" aria-hidden="true">👍</span></button>
          <button
            type="button"
            className="icon-action"
            aria-label="这条不相关，移入低分内容"
            title="不相关"
            onClick={() => onAction({ type: 'irrelevant', itemId: item.id, at: actionAt() }, '已移入低分内容')}
          >👎</button>
        </div>
      </div>
    </article>
  );
}

function FoldedRow({
  item,
  onAction,
  actionAt,
}: {
  item: FeedItemView;
  onAction: (action: FeedItemAction, message: string) => void;
  actionAt: () => string;
}) {
  return (
    <article className="folded-row">
      <div className="folded-type">{mediaMarks[item.mediaType]}</div>
      <div>
        <a href={item.url} target="_blank" rel="noreferrer" onClick={() => onAction({ type: 'opened_source', itemId: item.id, at: actionAt() }, '已记录打开原文')}><h3>{item.title}</h3></a>
        <p>{item.sourceName} · {item.rejectReason ?? '低分信号'}</p>
        <span>🤖 AI 摘要 · 未生成</span>
      </div>
      <button type="button" onClick={() => onAction({ type: 'set_highlight', itemId: item.id, highlighted: true, at: actionAt() }, '已恢复并置为高亮')}>↑ 恢复高亮</button>
    </article>
  );
}

function factLine(item: FeedItemView): string[] {
  const date = item.publishedAt ? new Date(item.publishedAt) : new Date(item.firstSeenAt);
  const facts = [
    date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    mediaLabels[item.mediaType],
    item.region,
  ];
  if (item.durationSeconds) {
    const hours = Math.floor(item.durationSeconds / 3600);
    const minutes = Math.round((item.durationSeconds % 3600) / 60);
    facts.push(hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`);
  } else if (item.contentChars) {
    facts.push(item.contentChars >= 10_000 ? `约 ${(item.contentChars / 10_000).toFixed(1)} 万字` : `约 ${item.contentChars.toLocaleString('zh-CN')} 字`);
  }
  return facts;
}

function coverMonogram(item: FeedItemView): string {
  const seed = item.companies[0] ?? item.persons[0] ?? item.sourceName;
  return seed.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || 'AF';
}

function coverStyle(item: FeedItemView): CSSProperties | undefined {
  if (!item.coverUrl || !/^https?:\/\//i.test(item.coverUrl)) return undefined;
  return {
    '--cover-image': `url(${JSON.stringify(item.coverUrl)})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  } as CSSProperties;
}

function emptySummary(item: FeedItemView): string {
  if (item.status === 'needs_body') return '该来源当前没有可用正文或字幕，因此没有生成摘要；标题与来源事实仍保留。';
  return '该条目在准入阶段被折叠，没有下载正文，也没有调用摘要模型。';
}
