/**
 * SilkWeb Image Ads — Milestone 2 internal policy checks.
 *
 * Copy is validated before any image is generated or delivered:
 * no invented discounts, prices, specs, testimonials,
 * endorsements, deadlines, scarcity, or before/after results.
 * A price or offer may appear ONLY when the user supplied it.
 * SilkWeb branding must never appear inside customer ad copy.
 * These checks are internal guidance — they never guarantee Meta
 * advertising approval.
 */

import type { ImageAdInput } from './imageAds.js';
import type { PlannedImageAd } from './imageAdsPlan.js';

export interface PolicyFinding {
  field: string;
  message: string;
}

const DISCOUNT_WORDS = ['discount', '% off', 'percent off', 'coupon', 'promo code', 'clearance'];
const TESTIMONIAL_WORDS = ['testimonial', 'review:', 'reviews:', 'stars', 'loved by', 'customers say', 'endorsed by', 'celebrity'];
const PRESSURE_WORDS = ['limited time', 'hurry', 'act now', 'last chance', 'only ', ' left', 'deadline', 'expires', 'don\'t miss', 'before it\'s gone'];
const RESULT_WORDS = ['before and after', 'before/after', 'guaranteed results', 'guarantee', 'results may vary'];
const RANK_WORDS = ['#1', 'number one', 'best in', 'best-ever'];

function containsAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w));
}

function mentionsPrice(text: string): boolean {
  return /[$€£¥₹]\s?\d/.test(text) || /\d\s?[$€£¥₹]/.test(text) || /\b\d+(\.\d{1,2})?\s?(usd|eur|gbp|ngn|ghs|kes|zar)\b/i.test(text);
}

/**
 * Check planned copy against the supplied brief. Returns findings;
 * empty means the copy passed the internal checks.
 */
export function checkImageAdPolicy(plans: PlannedImageAd[], input: ImageAdInput): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  const priceAllowed = input.price.length > 0 || /[$€£¥₹\d]/.test(input.specialOffer);
  const offerAllowed = input.specialOffer.length > 0;

  plans.forEach((plan, index) => {
    const at = (field: string): string => `plans[${index}].${field}`;
    const text = `${plan.headline}\n${plan.body}\n${plan.cta}`.toLowerCase();
    const raw = `${plan.headline}\n${plan.body}\n${plan.cta}`;

    if (containsAny(text, DISCOUNT_WORDS) && !offerAllowed) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} mentions a discount or offer that was not supplied.` });
    }
    if (mentionsPrice(raw) && !priceAllowed) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} mentions a price that was not supplied.` });
    }
    if (containsAny(text, TESTIMONIAL_WORDS)) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} contains testimonial or endorsement language.` });
    }
    if (containsAny(text, PRESSURE_WORDS) && !offerAllowed) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} contains scarcity or deadline language that was not supplied.` });
    }
    if (containsAny(text, RESULT_WORDS)) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} contains results or guarantee language.` });
    }
    if (containsAny(text, RANK_WORDS)) {
      findings.push({ field: at('body'), message: `Plan ${index + 1} contains an unsubstantiated ranking claim.` });
    }
    if (text.includes('silkweb')) {
      findings.push({ field: at('headline'), message: `Plan ${index + 1} must not place SilkWeb branding inside customer ad copy.` });
    }
    if (input.productName && !raw.toLowerCase().includes(input.productName.toLowerCase().split(' ')[0])) {
      // Soft signal only when a name was supplied and no photo: copy should stay grounded.
      if (!input.upload && !text.includes('pictured product')) {
        findings.push({ field: at('headline'), message: `Plan ${index + 1} does not reference the supplied product.` });
      }
    }
  });
  return findings;
}
