export interface StructuralInput {
  mediaType: 'article' | 'video' | 'podcast';
  durationSeconds?: number | null;
  contentChars?: number | null;
}

export interface StructuralSignal {
  /** 乘性系数 0-1，作用在 title_signal 上——只降权，不排除（§0.4 召回优先） */
  factor: number;
  notes: string[];
}

const MIN_MEDIA_SECONDS = 900;   // 15 分钟
const MIN_ARTICLE_CHARS = 2000;

/**
 * 零成本结构性辅助信号。只降权，永不排除。
 * 短视频和短文可能仍是好访谈（剪辑片段、精编版），所以是 factor 不是 filter。
 */
export function evaluateStructural(input: StructuralInput): StructuralSignal {
  const notes: string[] = [];
  let factor = 1.0;

  const d = input.durationSeconds;
  if (input.mediaType !== 'article' && typeof d === 'number' && d > 0 && d < MIN_MEDIA_SECONDS) {
    factor *= 0.6;
    notes.push(`short_media:${d}s`);
  }

  // ⚠️ 字数判据对所有类型都要看，不只文章。
  //    实测：YouTube RSS 不提供时长，短切片只能靠字幕字数识别出来——
  //    一条 1083 字的「正片切片」不该和一场完整访谈同等对待。
  const c = input.contentChars;
  if (typeof c === 'number' && c > 0 && c < MIN_ARTICLE_CHARS) {
    factor *= 0.6;
    notes.push(`short_body:${c}chars`);
  }
  return { factor, notes };
}
