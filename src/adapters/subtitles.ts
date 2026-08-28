import { normalizeText } from './html.js';

export function vttToText(vtt: string): string {
  const captions: string[] = [];
  let current: string[] = [];
  let inMetadataBlock = false;

  const flush = () => {
    const caption = normalizeText(current.join(' ').replace(/<[^>]+>/g, ''));
    current = [];
    if (!caption) return;
    const previous = captions.at(-1);
    if (previous === caption || previous?.startsWith(caption)) return;
    if (previous && caption.startsWith(previous)) captions[captions.length - 1] = caption;
    else captions.push(caption);
  };

  for (const rawLine of vtt.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^(WEBVTT|Kind:|Language:)/i.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(line)) {
      flush();
      inMetadataBlock = true;
      continue;
    }
    if (!line) {
      flush();
      inMetadataBlock = false;
      continue;
    }
    if (inMetadataBlock || /^\d+$/.test(line)) continue;
    if (line.includes('-->')) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return normalizeText(captions.join(' '));
}
