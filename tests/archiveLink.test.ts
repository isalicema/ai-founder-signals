import { describe, expect, it } from 'vitest';
import { buildArchiveLinker, type ArchiveRow } from '../src/feed/archiveLink';

const day = (date: string) => new Date(`${date}T00:00:00Z`);
let nextId = 0;
const row = (override: Partial<ArchiveRow>): ArchiveRow => {
  nextId += 1;
  const id = override.id ?? `archive-${nextId}`;
  return {
    id,
    title: 'Synthetic archive note',
    persons: [],
    companies: [],
    sourceId: 'other-source',
    contentChars: 30_000,
    publishedAt: day('2026-11-01'),
    archivedAt: day('2026-11-02'),
    obsidianPath: `Research Notes/${id}.md`,
    ...override,
  };
};

const archive: ArchiveRow[] = [
  row({
    id: 'novacanvas-full',
    title: 'How NovaCanvas launched',
    persons: ['Ada Rivera'],
    companies: ['NovaCanvas'],
    sourceId: 'studio-talks',
    contentChars: 48_000,
    publishedAt: day('2026-11-10'),
    archivedAt: day('2026-11-11'),
    obsidianPath: 'Research Notes/2026-11-11-novacanvas-launch.md',
  }),
  row({
    id: 'novacanvas-duplicate-record',
    title: 'NovaCanvas launch transcript',
    persons: ['Ada Rivera'],
    companies: ['NovaCanvas'],
    obsidianPath: 'Research Notes/2026-11-11-novacanvas-launch.md',
  }),
  row({
    id: 'novacanvas-strategy',
    title: 'NovaCanvas product strategy',
    persons: ['Sam Chen'],
    companies: ['NovaCanvas'],
    obsidianPath: 'Research Notes/2026-10-20-novacanvas-strategy.md',
  }),
  row({ id: 'weekly-1', persons: ['Jordan Lee'], sourceId: 'weekly-show' }),
  row({ id: 'weekly-2', persons: ['Jordan Lee'], sourceId: 'weekly-show' }),
  row({ id: 'weekly-3', persons: ['Jordan Lee'], companies: ['SideProject'], sourceId: 'weekly-show' }),
];
const link = buildArchiveLinker(archive, new Set(['platformco']));
const card = (override: Record<string, unknown> = {}) => ({
  id: 'card',
  title: '',
  persons: [],
  companies: [],
  sourceId: 'studio-talks',
  sourceName: 'Studio Talks',
  contentChars: 3_000,
  obsidianPath: null,
  publishedAt: day('2026-11-16'),
  ...override,
});

describe('archive link', () => {
  it('hints that a short same-source item may relate to an archived full item', () => {
    const result = link(card({ title: 'A short NovaCanvas launch excerpt', companies: ['NovaCanvas'] }));
    expect(result).toMatchObject({ kind: 'full', count: 2 });
    expect(result?.full?.person).toBe('Ada Rivera');
  });

  it('keeps the full-item hint conservative when publication dates are far apart', () => {
    const result = link(card({
      title: 'NovaCanvas one year later',
      companies: ['NovaCanvas'],
      publishedAt: day('2027-03-01'),
    }));
    expect(result?.kind).toBe('related');
  });

  it('ignores broad platforms and recurring hosts as the only clue', () => {
    expect(link(card({ title: 'PlatformCo update', companies: ['PlatformCo'] }))).toBeNull();
    expect(link(card({
      title: 'Jordan Lee on startups',
      persons: ['Jordan Lee'],
      sourceId: 'weekly-show',
      sourceName: 'Weekly Show',
    }))).toBeNull();
  });

  it('prefers a named person and deduplicates multiple records for one note path', () => {
    const result = link(card({ title: 'Conversation with Ada Rivera', persons: ['Ada Rivera'] }));
    expect(result?.name).toBe('Ada Rivera');
    expect(result?.count).toBe(1);
  });

  it('never links a card to itself or to its own note path', () => {
    const ownOnly = buildArchiveLinker([archive[0]!], new Set());
    expect(ownOnly(card({ id: 'novacanvas-full', persons: ['Ada Rivera'] }))).toBeNull();
    expect(link(card({
      id: 'another-record',
      persons: ['Ada Rivera'],
      obsidianPath: 'Research Notes/2026-11-11-novacanvas-launch.md',
    }))).toBeNull();
  });

  it('returns null for an empty archive and for a source name used as the only clue', () => {
    expect(buildArchiveLinker([], new Set())(card({ title: 'Anything' }))).toBeNull();
    const sourceOnly = buildArchiveLinker([
      row({ id: 'source-note', companies: ['Studio Talks'] }),
    ], new Set());
    expect(sourceOnly(card({ companies: ['Studio Talks'] }))).toBeNull();
  });
});
