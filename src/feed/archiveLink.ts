import type { ArchiveLink, ArchiveNoteRef } from './types';

/**
 * Adds read-only context from archived notes to new feed cards.
 * Matching never changes scoring, filtering, card order, or feedback state.
 */
export interface ArchiveRow {
  id: string;
  title: string;
  persons: string[] | null;
  companies: string[] | null;
  sourceId: string;
  contentChars: number | null;
  publishedAt: Date | null;
  archivedAt: Date;
  obsidianPath: string;
}

export interface CardForLink {
  id: string;
  title: string;
  persons: string[];
  companies: string[];
  sourceId: string;
  sourceName: string;
  contentChars: number | null;
  obsidianPath: string | null;
}

/** A company seen in this many recent items is too broad to match on its own. */
export const GENERIC_COMPANY_MIN_ITEMS = 8;
/** A company present across this many distinct notes is also considered broad. */
const GENERIC_COMPANY_MIN_NOTES = 5;
/** A short item can only hint at a related full item within this time window. */
const FULL_EPISODE_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
/** Keep the full-item heuristic aligned with the existing tier length threshold. */
const FULL_LENGTH_CHARS = 20_000;
/** Very short names are unsafe title-match clues. */
const MIN_NAME_LENGTH = 3;

const norm = (name: string) => name.trim().toLowerCase();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleMentions(title: string, name: string): boolean {
  if (name.length < MIN_NAME_LENGTH) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(title);
}

export function genericCompanies(recent: Array<{ companies: string[] | null }>): Set<string> {
  const counts = new Map<string, number>();
  for (const row of recent) {
    for (const name of new Set((row.companies ?? []).map(norm))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count >= GENERIC_COMPANY_MIN_ITEMS).map(([name]) => name));
}

interface Match {
  row: ArchiveRow;
  names: Set<string>;
  sharedPerson: boolean;
}

export interface CardTiming {
  publishedAt: Date | null;
}

/** Names recurring in at least half of one source's archive are treated as host/source noise. */
function hostNames(archive: ArchiveRow[]): Set<string> {
  const bySource = new Map<string, ArchiveRow[]>();
  for (const row of archive) bySource.set(row.sourceId, [...(bySource.get(row.sourceId) ?? []), row]);
  const hosts = new Set<string>();
  for (const rows of bySource.values()) {
    if (rows.length < 3) continue;
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const name of new Set([...(row.persons ?? []), ...(row.companies ?? [])].map(norm))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    for (const [name, count] of counts) {
      if (count >= 3 && count >= rows.length / 2) hosts.add(name);
    }
  }
  return hosts;
}

export function buildArchiveLinker(archive: ArchiveRow[], recentGeneric: Set<string>) {
  const noteCounts = new Map<string, Set<string>>();
  for (const row of archive) {
    for (const name of new Set((row.companies ?? []).map(norm))) {
      noteCounts.set(name, (noteCounts.get(name) ?? new Set()).add(row.obsidianPath));
    }
  }
  const generic = new Set(recentGeneric);
  for (const [name, notes] of noteCounts) {
    if (notes.size >= GENERIC_COMPANY_MIN_NOTES) generic.add(name);
  }
  const hosts = hostNames(archive);
  const specific = (name: string) => (
    norm(name).length >= MIN_NAME_LENGTH && !generic.has(norm(name)) && !hosts.has(norm(name))
  );

  return function linkArchive(card: CardForLink & CardTiming): ArchiveLink | null {
    const cardPersons = new Set(card.persons.map(norm));
    const source = norm(card.sourceName);
    const usable = (name: string) => specific(name) && !source.includes(norm(name));
    const cardNames = [...card.persons, ...card.companies].filter(usable);
    const matches: Match[] = [];

    for (const row of archive) {
      if (row.id === card.id) continue;
      if (card.obsidianPath && row.obsidianPath === card.obsidianPath) continue;
      const rowNames = [...(row.persons ?? []), ...(row.companies ?? [])].filter(usable);
      const names = new Set<string>();
      for (const name of rowNames) {
        if (cardNames.some((own) => norm(own) === norm(name))) names.add(name);
      }
      for (const name of rowNames) {
        if (titleMentions(card.title, name)) names.add(name);
      }
      for (const name of cardNames) {
        if (titleMentions(row.title, name)) names.add(name);
      }
      if (names.size === 0) continue;
      const sharedPerson = (row.persons ?? []).some((person) => (
        specific(person) && cardPersons.has(norm(person))
      ));
      matches.push({ row, names, sharedPerson });
    }
    if (matches.length === 0) return null;

    const byNote = new Map<string, Match>();
    for (const match of matches) {
      const kept = byNote.get(match.row.obsidianPath);
      if (!kept || match.row.archivedAt > kept.row.archivedAt) {
        byNote.set(match.row.obsidianPath, match);
      }
    }
    const unique = [...byNote.values()];

    const cardIsShort = (card.contentChars ?? 0) < FULL_LENGTH_CHARS;
    const full = unique
      .filter((match) => match.row.sourceId === card.sourceId && cardIsShort
        && (match.row.contentChars ?? 0) >= FULL_LENGTH_CHARS
        && card.publishedAt !== null && match.row.publishedAt !== null
        && Math.abs(card.publishedAt.getTime() - match.row.publishedAt.getTime()) <= FULL_EPISODE_WINDOW_MS)
      .sort((first, second) => (
        Number(second.sharedPerson) - Number(first.sharedPerson)
        || second.row.archivedAt.getTime() - first.row.archivedAt.getTime()
      ))[0];

    const tally = new Map<string, number>();
    for (const match of unique) {
      for (const name of match.names) tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    const isPerson = (name: string) => cardPersons.has(norm(name));
    const label = [...tally].sort((first, second) => (
      Number(isPerson(second[0])) - Number(isPerson(first[0]))
      || second[1] - first[1]
      || first[0].localeCompare(second[0])
    ))[0]![0];

    const notes: ArchiveNoteRef[] = unique
      .map((match) => toNote(match.row))
      .sort((first, second) => second.date.localeCompare(first.date));

    return {
      kind: full ? 'full' : 'related',
      name: label,
      count: notes.length,
      full: full ? toNote(full.row) : null,
      notes,
    };
  };
}

function toNote(row: ArchiveRow): ArchiveNoteRef {
  const file = row.obsidianPath.split('/').pop() ?? row.obsidianPath;
  return {
    path: row.obsidianPath,
    label: file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, ''),
    date: file.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? row.archivedAt.toISOString().slice(0, 10),
    person: row.persons?.[0] ?? null,
  };
}
