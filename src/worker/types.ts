export type JobKind = 'discover' | 'process' | 'rescore';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type JobPayload = Record<string, unknown>;
