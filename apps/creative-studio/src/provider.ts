/**
 * Provider boundary for Milestone 2A concept generation.
 *
 * Real Meta Muse inference stays disabled until provider
 * configuration is explicitly verified. The deterministic test
 * provider below is marked `testOnly` and must never be served
 * as live AI output — the orchestrator refuses it unless the
 * caller explicitly opts in, and the HTTP endpoint never opts in.
 */
import type { CampaignContext } from './campaign.js';

export interface ConceptProvider {
  readonly name: string;
  /** Test doubles set this; live paths must reject them. */
  readonly testOnly?: boolean;
  generate(context: CampaignContext): Promise<unknown>;
}

export interface TestProviderIds {
  styleIds: [string, string];
  frameworkIds: [string, string];
}

/**
 * Injected deterministic test double. Output derives only from the
 * supplied campaign context plus explicitly configured ids — the
 * same input always yields the same two concepts. Never wire this
 * into a live response path.
 */
export class DeterministicTestProvider implements ConceptProvider {
  readonly name = 'deterministic-test';
  readonly testOnly = true as const;
  private readonly ids: TestProviderIds;

  constructor(ids: TestProviderIds) {
    this.ids = ids;
  }

  async generate(context: CampaignContext): Promise<unknown> {
    const audience = context.audience ?? 'new customers';
    const channel = context.channel ?? 'paid social';
    const direction = context.creativeDirection ?? 'clean and confident';
    const brand = context.brand ? ` from ${context.brand}` : '';
    const offer = context.offer ? ` Plus ${context.offer}.` : '';
    return [
      {
        id: 'test-concept-1',
        angle: `Everyday ease with ${context.product} for ${audience}`,
        headline: `Meet ${context.product} built for ${channel}`,
        primaryCopy: `Discover ${context.product}${brand}, made to help you ${context.objective}. ${direction}.${offer}`,
        cta: 'Shop now',
        visualDirection: `Close crop of ${context.product} in soft daylight, ${direction} mood.`,
        photographyPrompt: `Studio photograph of ${context.product}, soft daylight, minimal backdrop, ${direction}.`,
        styleId: this.ids.styleIds[0],
        frameworkId: this.ids.frameworkIds[0],
      },
      {
        id: 'test-concept-2',
        angle: `Social proof weekend with ${context.product} for ${audience}`,
        headline: `Why ${audience} choose ${context.product}`,
        primaryCopy: `See how ${context.product}${brand} fits real routines on ${channel} and helps you ${context.objective}.${offer}`,
        cta: 'Learn more',
        visualDirection: `Candid ${channel} moment featuring ${context.product}, warm ${direction} grade.`,
        photographyPrompt: `Lifestyle photograph of a person using ${context.product} outdoors, candid ${channel} feel, ${direction}.`,
        styleId: this.ids.styleIds[1],
        frameworkId: this.ids.frameworkIds[1],
      },
    ];
  }
}

/**
 * Real inference is enabled only when BOTH the provider selector
 * and a credentials variable are explicitly set. There is no live
 * provider implementation in this milestone, so the endpoint still
 * answers "unavailable" — this gate only records the opt-in.
 */
export function isLiveProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SILKWEB_CREATIVE_PROVIDER === 'live' && (env.SILKWEB_MUSE_API_KEY ?? '').length > 0;
}
