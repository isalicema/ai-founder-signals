/**
 * 摘要的机器校验。
 *
 * prompt 里写了「禁止输出引号包裹的原话」，但 prompt 是请求不是保证。
 * 系统不保存原文（v1.2 阅后即焚），一旦模型编一句原话出来，**事后没有任何办法核验**。
 * 所以这条必须由代码守着，不能靠 prompt 自觉，也不能靠人眼看。
 */

/** 引文长度阈值：短引号多是产品名/术语（如「Agent」"copilot"），长的才是在冒充原话 */
export const QUOTED_SPEECH_MIN_CHARS = 12;

const QUOTE_PAIRS: Array<[string, string]> = [
  ['“', '”'], // “ ”
  ['‘', '’'], // ‘ ’
  ['「', '」'], // 「 」
  ['『', '』'], // 『 』
  ['"', '"'],
  ["'", "'"],
];

export interface QuotedSpan {
  text: string;
  start: number;
  end: number;
}

export function findQuotedSpeech(summary: string, minChars = QUOTED_SPEECH_MIN_CHARS): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inner = open === close ? `[^${escape(close)}]` : `[^${escape(open)}${escape(close)}]`;
    const re = new RegExp(`${escape(open)}(${inner}{${minChars},})${escape(close)}`, 'g');
    for (const m of summary.matchAll(re)) {
      spans.push({ text: m[1] ?? '', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** 兜底：模型两次都不听话时，把引号连内容一起摘掉，宁可摘要少一句也不留假原话 */
export function stripQuotedSpeech(summary: string, minChars = QUOTED_SPEECH_MIN_CHARS): string {
  let out = summary;
  for (const span of findQuotedSpeech(summary, minChars).reverse()) {
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out.replace(/\s{2,}/g, ' ').replace(/[，,、]\s*[。.]/g, '。').trim();
}

export interface SummaryCheck {
  ok: boolean;
  quoted: QuotedSpan[];
  /** 长度只警告不拦截——中英文摘要字数天然不同 */
  lengthWarning: string | null;
}

export function checkSummary(summary: string): SummaryCheck {
  const quoted = findQuotedSpeech(summary);
  const n = summary.trim().length;
  return {
    ok: quoted.length === 0,
    quoted,
    lengthWarning: n < 60 ? `summary_too_short:${n}` : n > 700 ? `summary_too_long:${n}` : null,
  };
}
