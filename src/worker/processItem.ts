import { admit, type AdmissionInput, type AdmissionResult, type LlmJudge } from '../pipeline/admission/index.js';
import type { Tier } from '../pipeline/tier/index.js';
import { withTempWorkspace } from './tempWorkspace.js';

export interface PersistableAnalysis {
  summary: string;
  tags: string[];
  persons: string[];
  companies: string[];
  modelVersion: string;
  contentChars?: number;
  simhash?: bigint;
}

export interface FoldedItem {
  tier: Extract<Tier, 'folded'>;
  isFounderInterview: false;
  admissionConfidence: number;
  rejectReason: string;
  summary: null;
}

export interface ProcessItemDependencies {
  llmJudge?: LlmJudge;
  /** Inserts metadata-only folded items. It must not fetch a body or call the summarizer. */
  insertFolded: (item: FoldedItem, admission: AdmissionResult) => Promise<void>;
  /**
   * Fetches and analyzes accepted content inside the owned temporary directory.
   * Its return type deliberately excludes rawText so raw content cannot cross
   * the worker lifecycle boundary into persistence code.
   */
  fetchAndAnalyze: (workspace: string, admission: AdmissionResult) => Promise<PersistableAnalysis>;
  insertAccepted: (analysis: PersistableAnalysis, admission: AdmissionResult) => Promise<void>;
}

export interface ProcessItemResult {
  outcome: 'folded' | 'accepted';
  admission: AdmissionResult;
}

/**
 * Worker skeleton that makes the two admission invariants executable:
 * folded items are persisted, and they never download a body or request a summary.
 */
export async function processItem(
  input: AdmissionInput,
  dependencies: ProcessItemDependencies,
): Promise<ProcessItemResult> {
  const admission = await admit(input, dependencies.llmJudge);

  if (!admission.shouldFetchBody) {
    await dependencies.insertFolded(
      {
        tier: 'folded',
        isFounderInterview: false,
        admissionConfidence: admission.admissionConfidence,
        rejectReason: admission.rejectReason ?? 'admission_rejected',
        summary: null,
      },
      admission,
    );
    return { outcome: 'folded', admission };
  }

  const analysis = await withTempWorkspace((workspace) =>
    dependencies.fetchAndAnalyze(workspace, admission),
  );
  await dependencies.insertAccepted(analysis, admission);
  return { outcome: 'accepted', admission };
}
