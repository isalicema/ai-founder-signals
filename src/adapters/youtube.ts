import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import type { AdapterSource, DiscoveredItem, EphemeralContent, SourceAdapter } from './types.js';
import type { FetchFn } from './http.js';
import { fetchTextResource } from './http.js';
import { parseFeed } from './feedParser.js';
import { AdapterError, FetchBlockedError } from './errors.js';
import { systemCommandRunner, type CommandRunner } from './command.js';
import { vttToText } from './subtitles.js';

export interface YouTubeAdapterOptions {
  fetcher?: FetchFn;
  commandRunner?: CommandRunner;
  ytDlpPath?: string;
  subtitleLanguages?: string;
}

export class YouTubeAdapter implements SourceAdapter {
  readonly kinds = ['youtube'] as const;
  readonly #fetcher?: FetchFn;
  readonly #commandRunner: CommandRunner;
  readonly #ytDlpPath: string;
  readonly #subtitleLanguages?: string;

  constructor(options: YouTubeAdapterOptions = {}) {
    this.#fetcher = options.fetcher;
    this.#commandRunner = options.commandRunner ?? systemCommandRunner;
    this.#ytDlpPath = options.ytDlpPath ?? 'yt-dlp';
    this.#subtitleLanguages = options.subtitleLanguages;
  }

  async discover(source: AdapterSource): Promise<DiscoveredItem[]> {
    const response = await fetchTextResource(source.url, {
      fetcher: this.#fetcher,
      maxBytes: 5 * 1024 * 1024,
      accept: 'application/atom+xml,application/xml;q=0.9,*/*;q=0.5',
    });
    return parseFeed(response.text, {
      sourceUrl: response.url,
      forcedMediaType: 'video',
      languageHint: source.language,
    });
  }

  async fetch(item: DiscoveredItem, context: { workspace: string }): Promise<EphemeralContent> {
    await assertOwnedWorkspace(context.workspace);
    const outputTemplate = join(context.workspace, '%(id)s.%(ext)s');
    let commandFailure: unknown;

    for (const languages of this.#subtitleLanguages
      ? [this.#subtitleLanguages]
      : subtitleLanguageCandidates(item.languageHint)) {
      const args = [
        '--ignore-config',
        '--no-playlist',
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs', languages,
        '--sub-format', 'vtt',
        '--output', outputTemplate,
        '--quiet',
        '--no-warnings',
        '--', item.url,
      ];

      try {
        await this.#commandRunner.run(this.#ytDlpPath, args, {
          cwd: context.workspace,
          timeoutMs: 120_000,
        });
      } catch (cause) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
        if (code === 'ENOENT') throw new AdapterError('yt_dlp_unavailable', { retryable: false, cause });
        commandFailure = cause;
      }

      // yt-dlp can download one requested language, then fail on a later one.
      // A valid subtitle file still makes this fetch successful.
      const subtitle = await selectSubtitleFile(context.workspace, item.languageHint);
      if (subtitle) return readSubtitle(subtitle);
      if (commandFailure) break;
    }

    if (commandFailure) {
      throw new AdapterError('youtube_subtitle_fetch_failed', { retryable: true, cause: commandFailure });
    }
    throw new FetchBlockedError('youtube_no_subtitles');
  }
}

function subtitleLanguageCandidates(languageHint?: string): string[] {
  const language = languageHint?.trim();
  if (language?.toLowerCase().startsWith('zh')) return ['zh-Hans', 'zh-Hant', 'zh'];
  if (language?.toLowerCase().startsWith('en')) return ['en-orig', 'en'];
  return [...new Set([language, language && `${language}-orig`, 'en-orig', 'en'].filter(Boolean))] as string[];
}

async function readSubtitle(subtitle: { path: string; language: string }): Promise<EphemeralContent> {
  const info = await stat(subtitle.path);
  if (info.size > 10 * 1024 * 1024) throw new AdapterError('response_too_large', { retryable: false });
  const rawText = vttToText(await readFile(subtitle.path, 'utf8'));
  if (rawText.length < 20) throw new FetchBlockedError('youtube_no_subtitles');
  return { rawText, language: subtitle.language, provenance: 'transcript' };
}

async function selectSubtitleFile(
  workspace: string,
  languageHint?: string,
): Promise<{ path: string; language: string } | null> {
  const files = (await readdir(workspace))
    .filter((name) => name.endsWith('.vtt') && !name.includes('live_chat'))
    .sort((a, b) => subtitleRank(a, languageHint) - subtitleRank(b, languageHint) || a.localeCompare(b));
  const filename = files[0];
  if (!filename) return null;
  const stem = filename.slice(0, -'.vtt'.length);
  const language = stem.includes('.') ? stem.slice(stem.indexOf('.') + 1) : languageHint ?? 'und';
  return { path: join(workspace, filename), language };
}

function subtitleRank(filename: string, languageHint?: string): number {
  const language = languageHint?.toLowerCase();
  if (language && filename.toLowerCase().includes(`.${language}.`)) return 0;
  if (/\.en(?:[.-]|\.vtt$)/i.test(filename)) return 1;
  if (/\.zh(?:[.-]|\.vtt$)/i.test(filename)) return 2;
  return 3;
}

async function assertOwnedWorkspace(workspace: string): Promise<void> {
  try {
    const [resolvedWorkspace, resolvedTmp] = await Promise.all([realpath(workspace), realpath(tmpdir())]);
    const pathFromTmp = relative(resolvedTmp, resolvedWorkspace);
    if (
      pathFromTmp.startsWith(`..${sep}`) ||
      pathFromTmp === '..' ||
      basename(resolvedWorkspace).startsWith('afs-worker-') === false
    ) {
      throw new AdapterError('invalid_workspace', { retryable: false });
    }
  } catch (cause) {
    if (cause instanceof AdapterError) throw cause;
    throw new AdapterError('invalid_workspace', { retryable: false, cause });
  }
}
