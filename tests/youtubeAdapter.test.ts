import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandRunner } from '../src/adapters/command.js';
import type { AdapterSource, DiscoveredItem } from '../src/adapters/types.js';
import { YouTubeAdapter } from '../src/adapters/youtube.js';
import { withTempWorkspace } from '../src/worker/tempWorkspace.js';
import { YOUTUBE_FEED } from './fixtures/feeds.js';

const source: AdapterSource = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Any YouTube channel name',
  url: 'https://www.youtube.com/feeds/videos.xml?channel_id=test',
  language: 'en',
  ingestMethod: 'youtube',
  fetchMode: 'full',
};

const item: DiscoveredItem = {
  externalId: 'abcDEF_1234',
  url: 'https://www.youtube.com/watch?v=abcDEF_1234',
  title: 'A founder conversation',
  publishedAt: null,
  mediaType: 'video',
  languageHint: 'en',
};

describe('YouTubeAdapter', () => {
  it('discovers channel entries from the public Atom feed', async () => {
    const fetcher = vi.fn(async () => new Response(YOUTUBE_FEED, {
      headers: { 'content-type': 'application/atom+xml' },
    })) as typeof fetch;
    const adapter = new YouTubeAdapter({ fetcher });

    const items = await adapter.discover(source);

    expect(items[0]).toMatchObject({
      externalId: 'abcDEF_1234',
      mediaType: 'video',
      languageHint: 'en',
    });
  });

  it('downloads subtitle-only output inside withTempWorkspace and returns de-rolled text', async () => {
    let capturedWorkspace = '';
    const commandRunner: CommandRunner = {
      run: vi.fn(async (_executable, args, options) => {
        capturedWorkspace = options.cwd;
        expect(args).toContain('--skip-download');
        expect(args).toContain('--write-auto-subs');
        expect(args).not.toContain('--extract-audio');
        await writeFile(join(options.cwd, 'abcDEF_1234.en.vtt'), `WEBVTT

00:00:00.000 --> 00:00:01.000
We chose a narrow product

00:00:01.000 --> 00:00:02.000
We chose a narrow product first

00:00:02.000 --> 00:00:03.000
because users needed reliability.
`, 'utf8');
      }),
    };
    const adapter = new YouTubeAdapter({ commandRunner });

    const content = await withTempWorkspace((workspace) => adapter.fetch(item, { workspace }));

    expect(content).toEqual({
      rawText: 'We chose a narrow product first because users needed reliability.',
      language: 'en',
      provenance: 'transcript',
    });
    await expect(access(capturedWorkspace)).rejects.toThrow();
  });

  it('returns needs_body when yt-dlp finds no subtitles', async () => {
    const adapter = new YouTubeAdapter({ commandRunner: { run: vi.fn(async () => undefined) } });

    await expect(
      withTempWorkspace((workspace) => adapter.fetch(item, { workspace })),
    ).rejects.toMatchObject({ code: 'youtube_no_subtitles', itemStatus: 'needs_body' });
  });

  it('uses a subtitle file produced before yt-dlp reports a later language failure', async () => {
    const commandRunner: CommandRunner = {
      run: vi.fn(async (_executable, _args, options) => {
        await writeFile(join(options.cwd, 'abcDEF_1234.en-orig.vtt'), `WEBVTT

00:00:00.000 --> 00:00:01.000
The usable subtitle was already downloaded before a later request failed.
`, 'utf8');
        throw Object.assign(new Error('HTTP 429'), { code: 1 });
      }),
    };
    const adapter = new YouTubeAdapter({ commandRunner, subtitleLanguages: 'en-orig,zh-Hans' });

    const content = await withTempWorkspace((workspace) => adapter.fetch(item, { workspace }));

    expect(content).toMatchObject({ language: 'en-orig' });
    expect(content.rawText.length).toBeGreaterThan(20);
  });

  it('requires the M3-owned temporary workspace', async () => {
    const adapter = new YouTubeAdapter({ commandRunner: { run: vi.fn(async () => undefined) } });
    await expect(adapter.fetch(item, { workspace: '/private/tmp' }))
      .rejects.toMatchObject({ code: 'invalid_workspace' });
  });

  it('classifies a missing yt-dlp binary without storing command stderr', async () => {
    const missing = Object.assign(new Error('should not be persisted'), { code: 'ENOENT' });
    const adapter = new YouTubeAdapter({
      commandRunner: { run: vi.fn(async () => { throw missing; }) },
    });
    await expect(
      withTempWorkspace((workspace) => adapter.fetch(item, { workspace })),
    ).rejects.toMatchObject({ code: 'yt_dlp_unavailable', message: 'yt_dlp_unavailable' });
  });
});
