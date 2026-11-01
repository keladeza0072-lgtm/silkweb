/**
 * SilkWeb Image Ads — Milestone 2 live orchestration.
 *
 * Six separated stages:
 *  1. Input validation (imageAds.ts, incl. optional M2 details)
 *  2. Creative planning (Muse Spark 1.3 adapter)
 *  3. Policy validation (internal checks)
 *  4. Muse Image generation (one call per ad, no retries)
 *  5. Image finishing (verified 1080 x 1350 PNG, no bitmap font, no SilkWeb branding)
 *  6. Output verification (final shape check)
 *
 * Paid inference never runs unless the caller supplies live
 * planner/image providers AND the server environment is configured
 * (SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY). Tests inject
 * mock providers with allowTestProviders: true — no network.
 */

import {
  IMAGE_AD_HEIGHT,
  IMAGE_AD_WIDTH,
  validateImageAdInput,
  type ImageAdInput,
  type ImageAdIssue,
} from './imageAds.js';
import {
  validateImageAdPlans,
  type ImageAdPlanner,
  type PlannedImageAd,
} from './imageAdsPlan.js';
import { checkImageAdPolicy } from './imageAdsPolicy.js';
import { checkCopyQuality } from './creativeCopyIntelligence.js';
import { evaluateCreativePrinciples, type CreativeIntelligenceAssessment } from './creativePrincipleEvaluator.js';
import type { ImageGenerator } from './museImage.js';
import { finishLiveAdPngSharp } from './imageAdFinishSharp.js';
import { selectCreativeClasses } from './imageAdCreativeSelection.js';
import { renderBlueprintAd } from './imageAdBlueprintRenderer.js';
import {selectCreativeDirectorReferences} from './creativeDirector.js';
import {finishCreativeDirectorAd} from './creativeDirectorFinish.js';
import {finishTypographyV2} from './creativeTypographyV2.js';
import {segmentProductWithSam31} from './creativeSam31.js';
import { isLiveProviderConfigured } from './provider.js';

export interface LiveImageAd {
  id: string;
  audience: PlannedImageAd['audience'];
  angle: string;
  headline: string;
  body: string;
  cta: string;
  visualPrompt: string;
  width: number;
  height: number;
  pngDataUrl: string;
  referenceGuided: boolean;
}

export interface LiveDeps {
  planner: ImageAdPlanner;
  images: ImageGenerator;
  /** Tests set this to allow deterministic test doubles. The HTTP route never does. */
  allowTestProviders?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Optional diagnostic for controlled evaluation; not exposed to customers. */
  onSamOutcome?: (outcome: {status:'success'|'fallback'|'skipped'; maskCoverage?:number; reason?:string})=>void;
  /** Internal audit hook; never exposed in the customer response. */
  onCreativeAudit?: (audit:CreativeIntelligenceAssessment)=>void;
}

export interface LiveImageFailure {
  id: string;
  audience: PlannedImageAd['audience'];
  code: string;
  message: string;
}

export interface LiveSuccessPayload {
  ok: true;
  /** Absent/false on a full three-ad result; true when only some ads succeeded. */
  partial?: false;
  objective: string;
  productLabel: string;
  ads: LiveImageAd[];
  failures?: LiveImageFailure[];
  warning?: string;
  engine: { kind: 'meta'; planner: string; imagery: string };
  note: string;
}

export interface LivePartialPayload {
  ok: true;
  partial: true;
  objective: string;
  productLabel: string;
  ads: LiveImageAd[];
  failures: LiveImageFailure[];
  warning: string;
  engine: { kind: 'meta'; planner: string; imagery: string };
  note: string;
}

export type LiveOutcome =
  | { status: 200; payload: LiveSuccessPayload }
  | { status: 206; payload: LivePartialPayload }
  | { status: number; payload: { ok: false; issues?: ImageAdIssue[]; error?: { code: string; message: string } } };

function issues(status: number, issues: ImageAdIssue[]): LiveOutcome {
  return { status, payload: { ok: false, issues } };
}

function error(status: number, code: string, message: string): LiveOutcome {
  return { status, payload: { ok: false, error: { code, message } } };
}

/**
 * Full live outcome. Never throws — every failure maps to a payload.
 * Exactly one planner call and one image call per ad; no retries.
 */
export async function imageAdsGenerateLiveOutcome(body: unknown, deps: LiveDeps): Promise<LiveOutcome> {
  const env = deps.env ?? process.env;
  const liveConfigured = isLiveProviderConfigured(env);
  const testMode = deps.allowTestProviders === true;

  if (!liveConfigured && !testMode) {
    return error(503, 'PROVIDER_UNAVAILABLE', 'Live image-ads generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.');
  }
  if ((deps.planner.testOnly === true || deps.images.testOnly === true) && !testMode) {
    return error(500, 'TEST_PROVIDER_NOT_ALLOWED', 'Test-provider output must never be served as live generation.');
  }

  // Stage 1 — input validation.
  const checked = validateImageAdInput(body);
  if (!checked.ok) return issues(422, checked.issues);
  const input: ImageAdInput = checked.input;

  // Stage 2 — creative planning (exactly one planner call).
  let rawPlans: unknown;
  try {
    rawPlans = await deps.planner.plan(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown planner failure.';
    if (/timed out after \d+ms/.test(message)) return error(504, 'PLANNER_TIMEOUT', message.slice(0, 300));
    return error(502, 'PLANNER_ERROR', `Creative planning failed: ${message}`.slice(0, 400));
  }
  const validated = validateImageAdPlans(rawPlans);
  if (!validated.ok) {
    return error(502, 'INVALID_PLAN', validated.error);
  }

  // Stage 3 — policy validation.
  const findings = checkImageAdPolicy(validated.plans, input);
  if (findings.length > 0) {
    return {
      status: 422,
      payload: { ok: false, issues: findings.map((f) => ({ field: f.field, message: f.message })) },
    };
  }

  // Stage 3b — copy-quality gate (deterministic, pre-inference).
  // Runs after Muse Spark planning and before the first Muse Image
  // call, so weak or generic copy never reaches paid generation. The
  // copy is never silently rewritten and inference is never retried
  // here: unacceptable copy is reported as a non-success outcome and
  // no image is generated for any ad.
  const copyQuality = checkCopyQuality(validated.plans, {
    productName: input.productName,
    differentiator: input.differentiator,
    price: input.price,
    currency: input.currency,
    specialOffer: input.specialOffer,
  });
  if (!copyQuality.ok) {
    return {
      status: 422,
      payload: { ok: false, issues: copyQuality.issues.map((f) => ({ field: f.field, message: f.message })) },
    };
  }

  // Internal principle audit: connects each output to the selected book-inspired
  // execution criteria. Observations are not proof of persuasion or a
  // substitute for human evaluation. Never returned in the customer payload.
  const creativeAudit=evaluateCreativePrinciples(validated.plans,input);
  try { deps.onCreativeAudit?.(creativeAudit); } catch { /* diagnostics must not interrupt generation */ }

  // Stage 4 + 5 — image generation and finishing, one call per ad,
  // no retries. A per-ad failure is recorded truthfully and the loop
  // continues so successfully generated ads are never silently discarded.
  const ads: LiveImageAd[] = [];
  const failures: LiveImageFailure[] = [];
  let firstFatal: LiveOutcome | null = null;
  const recordFatal = (outcome: LiveOutcome): void => {
    if (firstFatal === null) firstFatal = outcome;
  };
  const creativeSelections = selectCreativeClasses(input).selections;
  const directorEnabled = env.SILKWEB_CREATIVE_DIRECTOR === 'on';
  const directorSelections = directorEnabled ? selectCreativeDirectorReferences(input).selections : [];
  // SAM runs at most once for the entire campaign. Failure falls back
  // transparently to the original uploaded product photograph.
  let generationInput = input;
  if (directorEnabled && env.SILKWEB_SAM31 === 'on' &&
      input.upload && !testMode && env.MODEL_API_KEY) {
    try {
      const sam = await segmentProductWithSam31(input, {
        apiKey: env.MODEL_API_KEY,
        timeoutMs: 120_000,
      });
      generationInput = { ...input, samCutoutPng: sam.cutout };
      deps.onSamOutcome?.({status:'success',maskCoverage:sam.maskCoverage});
    } catch (samError) {
      // No retries. Preserve the original photo and report diagnostic to evaluator.
      generationInput = input;
      deps.onSamOutcome?.({status:'fallback',reason:samError instanceof Error ? samError.message.slice(0,200):'Unknown SAM failure'});
    }
  } else {
    deps.onSamOutcome?.({status:'skipped',reason:!input.upload?'no product image':'SAM flag not active'});
  }
  for (let i = 0; i < validated.plans.length; i += 1) {
    const plan = validated.plans[i];
    let bytes: { png: Buffer; referenceGuided: boolean };
    try {
      bytes = await deps.images.generate(plan, generationInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown image failure.';
      const code = /timed out after \d+ms/.test(message) ? 'IMAGE_TIMEOUT' : 'IMAGE_ERROR';
      const status = code === 'IMAGE_TIMEOUT' ? 504 : 502;
      const limit = code === 'IMAGE_TIMEOUT' ? 300 : 400;
      failures.push({ id: plan.id, audience: plan.audience, code, message: `Ad ${i + 1}: ${message}`.slice(0, limit) });
      recordFatal(error(status, code, `Ad ${i + 1}: ${message}`.slice(0, limit)));
      continue;
    }
    let finished: Awaited<ReturnType<typeof finishLiveAdPngSharp>>;
    try {
      const selectedClass = creativeSelections.find(
        (selection) => selection.audience === plan.audience,
      )?.classId;

      if (directorEnabled) {
        const choice = directorSelections.find(s => s.audience === plan.audience);
        if (!choice) throw new Error('No reference selected for planned audience.');
        const editorial = await (env.SILKWEB_TYPOGRAPHY_V2 === 'on' ? finishTypographyV2 : finishCreativeDirectorAd)(
          bytes.png,
          {headline:plan.headline,body:plan.body,cta:plan.cta},
          choice,
        );
        if (!editorial.ok) throw new Error(editorial.reason);
        finished = {
          ok: true,
          pngDataUrl: editorial.pngDataUrl,
          width: editorial.width,
          height: editorial.height,
          layout: plan.audience === 'cold' ? 'discovery' : plan.audience === 'warm' ? 'consideration' : 'action',
        };
      } else {
        const blueprintResult = selectedClass
          ? await renderBlueprintAd(
              bytes.png,
              { headline: plan.headline, body: plan.body, cta: plan.cta },
              selectedClass,
            )
          : null;

        if (blueprintResult?.ok) {
          finished = {
            ok: true,
            pngDataUrl: blueprintResult.pngDataUrl,
            width: blueprintResult.width,
            height: blueprintResult.height,
            layout:
              plan.audience === 'cold' ? 'discovery' :
              plan.audience === 'warm' ? 'consideration' :
              'action',
          };
        } else {
          finished = await finishLiveAdPngSharp(
            bytes.png,
            { headline: plan.headline, body: plan.body, cta: plan.cta },
            plan.audience,
            `ads[${i}].png`,
            undefined,
            false,
          );
        }
      }
    } catch {
      const message = `Ad ${i + 1}: Image finishing failed unexpectedly.`;
      failures.push({
        id: plan.id,
        audience: plan.audience,
        code: 'IMAGE_FINISH_FAILED',
        message,
      });
      recordFatal(error(502, 'IMAGE_FINISH_FAILED', message));
      continue;
    }
    if (!finished.ok) {
      const message = finished.issues.map((f) => f.message).join(' ');
      failures.push({ id: plan.id, audience: plan.audience, code: 'IMAGE_FINISH_FAILED', message: `Ad ${i + 1}: ${message}`.slice(0, 400) });
      recordFatal(issues(502, finished.issues.map((f) => ({ field: f.field, message: f.message }))));
      continue;
    }
    ads.push({
      id: plan.id,
      audience: plan.audience,
      angle: plan.angle,
      headline: plan.headline,
      body: plan.body,
      cta: plan.cta,
      visualPrompt: plan.visualPrompt,
      width: finished.width,
      height: finished.height,
      pngDataUrl: finished.pngDataUrl,
      referenceGuided: bytes.referenceGuided,
    });
  }

  // Nothing usable: report the first failure exactly as before (no retries).
  if (ads.length === 0) {
    if (firstFatal !== null) return firstFatal;
    return error(502, 'IMAGE_VERIFICATION_FAILED', 'Expected exactly three verified advertisements.');
  }

  // Stage 6 — output verification. A full result covers cold, warm, and
  // hot; a partial result is verified ad-by-ad and labeled as partial.
  const productLabel = input.productName.length > 0 ? input.productName : 'Your product';
  const engine = { kind: 'meta' as const, planner: deps.planner.name, imagery: deps.images.name };
  const verified = verifyLiveAds(ads);
  if (!verified.ok) return error(502, 'IMAGE_VERIFICATION_FAILED', verified.message);

  if (failures.length === 0) {
    if (ads.length !== 3) return error(502, 'IMAGE_VERIFICATION_FAILED', 'Expected exactly three verified advertisements.');
    const audiences = ads.map((a) => a.audience).sort().join(',');
    if (audiences !== 'cold,hot,warm') return error(502, 'IMAGE_VERIFICATION_FAILED', 'Ads must cover cold, warm, and hot.');
    return {
      status: 200,
      payload: {
        ok: true,
        objective: input.objective,
        productLabel,
        ads,
        engine,
        note: 'Meta-generated advertisements. Copy and imagery were produced by Meta models from your supplied product facts.',
      },
    };
  }

  return {
    status: 206,
    payload: {
      ok: true,
      partial: true,
      objective: input.objective,
      productLabel,
      ads,
      failures,
      warning: `Only ${ads.length} of 3 ads could be generated. The failed ${failures.length === 1 ? 'ad was' : 'ads were'} not retried automatically — you can try again.`,
      engine,
      note: 'Partial Meta-generated result. Copy and imagery were produced by Meta models from your supplied product facts.',
    },
  };
}

/**
 * Per-ad output verification shared by full and partial results:
 * verified 1080 x 1350 PNG data URLs, known audiences, no duplicates.
 */
function verifyLiveAds(ads: LiveImageAd[]): { ok: true } | { ok: false; message: string } {
  const seen = new Set<string>();
  for (const ad of ads) {
    if (!ad.pngDataUrl.startsWith('data:image/png;base64,') || ad.width !== IMAGE_AD_WIDTH || ad.height !== IMAGE_AD_HEIGHT) {
      return { ok: false, message: `Ad ${ad.id} failed output verification.` };
    }
    if (ad.audience !== 'cold' && ad.audience !== 'warm' && ad.audience !== 'hot') {
      return { ok: false, message: `Ad ${ad.id} has an unknown audience.` };
    }
    if (seen.has(ad.audience)) {
      return { ok: false, message: 'Ads must cover distinct audiences.' };
    }
    seen.add(ad.audience);
  }
  return { ok: true };
}
