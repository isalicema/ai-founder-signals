import { convert } from 'html-to-text';

const SKIP_SELECTORS = ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form', 'aside'];

export function extractArticleText(html: string): string {
  const text = convert(html, {
    baseElements: {
      selectors: ['article', 'main', '[role="main"]', 'body'],
      orderBy: 'occurrence',
      returnDomByDefault: true,
    },
    decodeEntities: true,
    wordwrap: false,
    selectors: [
      ...SKIP_SELECTORS.map((selector) => ({ selector, format: 'skip' as const })),
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
    limits: {
      maxInputLength: 10 * 1024 * 1024,
      maxChildNodes: 100_000,
      maxDepth: 100,
    },
  });
  return normalizeText(text);
}

export function admissionSnippet(value: unknown): string | undefined {
  const raw = textValue(value);
  if (!raw) return undefined;
  const text = normalizeText(convert(raw, { wordwrap: false, decodeEntities: true }));
  return text ? text.slice(0, 500) : undefined;
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return textValue(value['#text']);
  return '';
}
