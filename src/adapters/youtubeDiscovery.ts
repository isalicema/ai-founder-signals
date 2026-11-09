import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandRunner } from './command.js';
import type { AdapterSource, DiscoveredItem } from './types.js';
import { AdapterError } from './errors.js';

const LIMIT = 30;

/** RSS outage fallback: exact uploads/playlist scope, metadata only, no invented dates. */
export async function discoverYouTubeMetadata(
  source: AdapterSource,
  runner: CommandRunner,
  executable: string,
): Promise<DiscoveredItem[]> {
  const url = new URL(source.url);
  const channel = url.searchParams.get('channel_id');
  const playlist = url.searchParams.get('playlist_id');
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.youtube.com' ||
    url.pathname !== '/feeds/videos.xml' ||
    url.username ||
    url.password ||
    Boolean(channel) === Boolean(playlist) ||
    (channel && !/^UC[\w-]{22}$/.test(channel)) ||
    (playlist && !/^[\w-]{10,100}$/.test(playlist))
  ) {
    throw new AdapterError('invalid_source_url', { retryable: false });
  }

  const list = playlist ?? `UU${channel!.slice(2)}`;
  const workspace = await mkdtemp(join(tmpdir(), 'afs-youtube-discover-'));
  try {
    try {
      await runner.run(
        executable,
        [
          '--ignore-config',
          '--skip-download',
          '--abort-on-error',
          '--playlist-end',
          String(LIMIT),
          '--quiet',
          '--no-warnings',
          '--print-to-file',
          '%(.{id,title,timestamp,channel_id,playlist_id,playlist_index,playlist_count,duration,thumbnail,description})j',
          join(workspace, '%(id)s.info.json'),
          '--',
          `https://www.youtube.com/playlist?list=${list}`,
        ],
        { cwd: workspace, timeoutMs: 180_000 },
      );
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      throw new AdapterError(
        code === 'ENOENT' ? 'yt_dlp_unavailable' : 'youtube_discovery_failed',
        { retryable: code !== 'ENOENT' },
      );
    }

    const files = (await readdir(workspace)).filter((file) => /^[\w-]{11}\.info\.json$/.test(file));
    if (!files.length || files.length > LIMIT) throw invalidMetadata();

    const items = new Map<string, DiscoveredItem>();
    const indices = new Set<number>();
    let expectedCount: number | undefined;
    for (const file of files) {
      if ((await stat(join(workspace, file))).size > 5 * 1024 * 1024) throw invalidMetadata();

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(await readFile(join(workspace, file), 'utf8'));
      } catch {
        throw invalidMetadata();
      }

      if (
        !data ||
        typeof data.id !== 'string' ||
        !/^[\w-]{11}$/.test(data.id) ||
        file !== `${data.id}.info.json` ||
        typeof data.title !== 'string' ||
        !data.title.trim() ||
        data.playlist_id !== list ||
        (channel && data.channel_id !== channel) ||
        typeof data.timestamp !== 'number' ||
        !Number.isFinite(data.timestamp) ||
        data.timestamp <= 0
      ) {
        throw invalidMetadata();
      }
      if (
        !Number.isInteger(data.playlist_index) ||
        (data.playlist_index as number) < 1 ||
        (data.playlist_index as number) > LIMIT ||
        !Number.isInteger(data.playlist_count) ||
        (data.playlist_count as number) < 1
      ) {
        throw invalidMetadata();
      }

      const count = Math.min(LIMIT, data.playlist_count as number);
      if (expectedCount !== undefined && expectedCount !== count) throw invalidMetadata();
      expectedCount = count;
      indices.add(data.playlist_index as number);

      const publishedAt = new Date(data.timestamp * 1000);
      if (!Number.isFinite(publishedAt.getTime())) throw invalidMetadata();
      items.set(data.id, {
        externalId: data.id,
        url: `https://www.youtube.com/watch?v=${data.id}`,
        title: data.title,
        publishedAt,
        mediaType: 'video',
        ...(typeof data.duration === 'number' && data.duration >= 0
          ? { durationSeconds: Math.round(data.duration) }
          : {}),
        ...(typeof data.thumbnail === 'string' && data.thumbnail.startsWith('https://')
          ? { coverUrl: data.thumbnail }
          : {}),
        ...(typeof data.description === 'string'
          ? { admissionSnippet: data.description.slice(0, 500) }
          : {}),
        ...(source.language ? { languageHint: source.language } : {}),
      });
    }

    if (
      items.size !== expectedCount ||
      indices.size !== expectedCount ||
      [...indices].some((index) => index > expectedCount!)
    ) {
      throw invalidMetadata();
    }
    console.info(`[youtube] discovery_fallback entries=${items.size}`);
    return [...items.values()].sort(
      (first, second) => second.publishedAt!.getTime() - first.publishedAt!.getTime(),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

function invalidMetadata(): AdapterError {
  return new AdapterError('youtube_discovery_incomplete', { retryable: true });
}
