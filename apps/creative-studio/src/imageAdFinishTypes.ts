/**
 * Shared type contracts for SilkWeb Creative's production image finisher.
 * No dependency on the experimental stroke-font renderer.
 */

export type FinishAudience = 'cold' | 'warm' | 'hot';

export type FinishLayout = 'discovery' | 'consideration' | 'action';

export interface FinishCopy {
  headline: string;
  body: string;
  cta: string;
}