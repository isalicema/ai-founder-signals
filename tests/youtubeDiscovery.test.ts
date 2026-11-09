import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { YouTubeAdapter } from '../src/adapters/youtube.js';
import type { AdapterSource } from '../src/adapters/types.js';
import type { CommandRunner } from '../src/adapters/command.js';

const channel = 'UCcefcZRL2oaA_uBNeo5UOWg';
const uploads = `UU${channel.slice(2)}`;
const source: AdapterSource = {
  id: 'test',
  name: 'YC',
  url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,
  language: 'en',
  ingestMethod: 'youtube',
  fetchMode: 'full',
};
const metadata = {
  id: 'Q78dJ0vkWe8',
  title: 'Founder interview',
  timestamp: 1794063614,
  duration: 2655,
  channel_id: channel,
  playlist_id: uploads,
  playlist_index: 1,
  playlist_count: 1,
  description: 'x'.repeat(700),
};
const unavailable = vi.fn(async () => new Response('', { status: 404 })) as typeof fetch;

function runnerWith(data: unknown, after?: () => void) {
  let workspace = '';
  const runner: CommandRunner = {
    run: vi.fn(async (_, args, options) => {
      workspace = options.cwd;
      expect(args).toContain('--skip-download');
      expect(args).toContain('--abort-on-error');
      expect(args).toContain('--print-to-file');
      expect(args).not.toContain('--write-info-json');
      await writeFile(join(workspace, 'Q78dJ0vkWe8.info.json'), JSON.stringify(data));
      after?.();
    }),
  };
  return { runner, workspace: () => workspace };
}

describe('YouTube RSS outage discovery', () => {
  it('falls back to exact uploads, retains source dates and removes temporary metadata', async () => {
    const candidate = runnerWith(metadata);
    const rows = await new YouTubeAdapter({
      fetcher: unavailable,
      commandRunner: candidate.runner,
    }).discover(source);

    expect(rows[0]).toMatchObject({
      externalId: metadata.id,
      publishedAt: new Date(metadata.timestamp * 1000),
      durationSeconds: 2655,
    });
    expect(rows[0]!.admissionSnippet).toHaveLength(500);
    expect(vi.mocked(candidate.runner.run).mock.calls[0]![1].at(-1)).toBe(
      `https://www.youtube.com/playlist?list=${uploads}`,
    );
    await expect(access(candidate.workspace())).rejects.toThrow();
  });

  it('keeps a playlist subscription within that exact playlist', async () => {
    const playlist = 'PLnJFlI3aINuUNaznonoFEgMUGLBiLmB-w';
    const candidate = runnerWith({ ...metadata, playlist_id: playlist, channel_id: 'another-channel' });
    await new YouTubeAdapter({ fetcher: unavailable, commandRunner: candidate.runner }).discover({
      ...source,
      url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlist}`,
    });
    expect(vi.mocked(candidate.runner.run).mock.calls[0]![1].at(-1)).toBe(
      `https://www.youtube.com/playlist?list=${playlist}`,
    );
  });

  it.each([
    { ...metadata, timestamp: undefined },
    { ...metadata, channel_id: 'wrong' },
    { ...metadata, playlist_id: 'wrong' },
    { ...metadata, timestamp: 1e100 },
    { ...metadata, playlist_count: 2 },
    { ...metadata, playlist_index: 2 },
  ])('rejects missing timestamps or wrong source identity', async (candidateMetadata) => {
    const candidate = runnerWith(candidateMetadata);
    await expect(
      new YouTubeAdapter({ fetcher: unavailable, commandRunner: candidate.runner }).discover(source),
    ).rejects.toMatchObject({ code: 'youtube_discovery_incomplete' });
    await expect(access(candidate.workspace())).rejects.toThrow();
  });

  it('never treats files left by a failed subprocess as a complete discovery', async () => {
    const candidate = runnerWith(metadata, () => {
      throw Error('private stderr must not be persisted');
    });
    await expect(
      new YouTubeAdapter({ fetcher: unavailable, commandRunner: candidate.runner }).discover(source),
    ).rejects.toMatchObject({
      code: 'youtube_discovery_failed',
      message: 'youtube_discovery_failed',
    });
    await expect(access(candidate.workspace())).rejects.toThrow();
  });

  it('rejects an empty fallback instead of falsely advancing discovery', async () => {
    await expect(
      new YouTubeAdapter({ fetcher: unavailable, commandRunner: { run: async () => {} } }).discover(
        source,
      ),
    ).rejects.toMatchObject({ code: 'youtube_discovery_incomplete' });
  });

  it('does not invoke yt-dlp for arbitrary external feed URLs', async () => {
    const run = vi.fn();
    await expect(
      new YouTubeAdapter({ fetcher: unavailable, commandRunner: { run } }).discover({
        ...source,
        url: `https://example.com/feeds/videos.xml?channel_id=${channel}`,
      }),
    ).rejects.toMatchObject({ code: 'invalid_source_url' });
    expect(run).not.toHaveBeenCalled();
  });
});
