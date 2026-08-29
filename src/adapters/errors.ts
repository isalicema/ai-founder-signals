export type AdapterErrorCode =
  | 'invalid_source_url'
  | 'private_source_url'
  | 'fetch_timeout'
  | 'fetch_failed'
  | 'response_too_large'
  | 'invalid_feed'
  | 'feed_not_found'
  | 'invalid_source_config'
  | 'invalid_api_response'
  | 'article_body_missing'
  | 'transcript_unavailable'
  | 'youtube_no_subtitles'
  | 'youtube_subtitle_fetch_failed'
  | 'yt_dlp_unavailable'
  | 'invalid_workspace'
  | 'unsupported_ingest_method';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;

  constructor(code: AdapterErrorCode, options: { retryable: boolean; cause?: unknown }) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = options.retryable;
  }
}

/** Maps to item.status='needs_body'; it is a supported degradation, not data loss. */
export class FetchBlockedError extends AdapterError {
  readonly itemStatus = 'needs_body' as const;

  constructor(code: Extract<AdapterErrorCode, 'article_body_missing' | 'transcript_unavailable' | 'youtube_no_subtitles'>) {
    super(code, { retryable: false });
    this.name = 'FetchBlockedError';
  }
}
