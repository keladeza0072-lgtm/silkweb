import { buildBlueprintPhotoGuidance } from './imageAdPhotoDirection.js';
import { selectCreativeDirectorReferences, buildDirectorImagePrompt } from './creativeDirector.js';
import { selectVisualStudyPairs } from './creativeVisualPairing.js';
import { loadApprovedSceneAsset } from './creativeApprovedScenes.js';
/**
 * SilkWeb Image Ads — Milestone 2 imagery adapter and PNG finishing.
 *
 * Muse Image 1.0 owns advertisement imagery. This module makes one
 * upstream image request per ad (no retries), supports
 * reference-guided editing when a product photo was supplied, and
 * finishes provider bytes into verified 1080 x 1350 PNG data URLs.
 *
 * Final customer ads never use the Milestone 1 bitmap font and never
 * carry SilkWeb branding inside the image: provider bytes pass
 * through verbatim after dimensional verification.
 */

import { decodePng, encodePng, IMAGE_AD_HEIGHT, IMAGE_AD_WIDTH } from './imageAds.js';
import type { ImageAdInput } from './imageAds.js';
import type { PlannedImageAd } from './imageAdsPlan.js';
import { resolveModelApiKey } from './provider.js';

export const MUSE_IMAGE_MODEL = 'muse-image-1.0';
export const MUSE_IMAGE_ENDPOINT = 'https://api.meta.ai/v1/images/generations';
export const MUSE_IMAGE_EDITS_ENDPOINT = 'https://api.meta.ai/v1/images/edits';
export const MUSE_IMAGE_TIMEOUT_MS = 60_000;
export const MAX_IMAGE_RESPONSE_BYTES = 12 * 1024 * 1024;

export interface MuseImageFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface MuseImageFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type MuseImageFetchFn = (url: string, init: MuseImageFetchInit) => Promise<MuseImageFetchResponse>;

export interface GeneratedImageBytes {
  png: Buffer;
  /** True when the request carried a product-photo reference. */
  referenceGuided: boolean;
}

export interface ImageGenerator {
  readonly name: string;
  readonly testOnly?: boolean;
  generate(plan: PlannedImageAd, input: ImageAdInput): Promise<GeneratedImageBytes>;
}

export interface MuseImageOptions {
  apiKey?: string;
  endpoint?: string;
  /** Override for the edits endpoint (derived from `endpoint` when omitted). */
  editsEndpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: MuseImageFetchFn;
  env?: NodeJS.ProcessEnv;
}

/**
 * Correctly formatted data URL for a validated product-photo upload.
 * PNG, JPEG, and WebP references are supported; the declared MIME type
 * always matches the sniffed upload bytes (see parseProductImage).
 */
export function uploadImageDataUrl(upload: NonNullable<ImageAdInput['upload']>): string {
  const mime = upload.format === 'png' ? 'image/png' : upload.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  return `data:${mime};base64,${upload.bytes.toString('base64')}`;
}

export interface MuseImageRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

/**
 * Documented Muse Image request shape per
 * https://dev.meta.ai/docs/image-generation and
 * https://dev.meta.ai/docs/api-reference/images/edit-image
 *
 * - No product photo: POST /v1/images/generations (text-to-image).
 * - Product photo supplied: POST /v1/images/edits with a JSON `images`
 *   array whose entries carry the reference as an `image_url` data URL.
 * - PNG output is explicitly requested (`output_format: "png"` with
 *   `response_format: "b64_json"`); `size` requests the 4:5 aspect, the
 *   provider returns its own resolution which finishing fits to 1080x1350.
 * - No undocumented top-level fields: unknown fields are rejected with
 *   HTTP 400, so `reference_image` / `reference_format` are never sent.
 */
export function buildMuseImageRequest(
  plan: PlannedImageAd,
  input: ImageAdInput,
  options: { endpoint?: string; editsEndpoint?: string; model?: string; approvedSceneDataUrl?: string } = {},
): MuseImageRequest {
  const generations = options.endpoint ?? MUSE_IMAGE_ENDPOINT;
  const edits = options.editsEndpoint
    ?? (options.endpoint && options.endpoint.includes('/generations')
      ? options.endpoint.replace('/generations', '/edits')
      : MUSE_IMAGE_EDITS_ENDPOINT);
  const body: Record<string, unknown> = {
    model: options.model ?? MUSE_IMAGE_MODEL,
    prompt: buildMuseImagePrompt(plan, input) + (input.samCutoutPng ? '\nThe LAST image is an optional transparent SAM segmentation of the SAME customer product. Use its outline to preserve product identity, but rely on the original customer photo for exact markings, color and appearance. The scene reference, if present, defines environment and light.' : ''),
    size: `${IMAGE_AD_WIDTH}x${IMAGE_AD_HEIGHT}`,
    n: 1,
    response_format: 'b64_json',
    output_format: 'png',
  };
  const refs: Array<{image_url:string}> = [];
  if (options.approvedSceneDataUrl) refs.push({image_url:options.approvedSceneDataUrl});
  if (input.upload) refs.push({image_url:uploadImageDataUrl(input.upload)});
  if (input.upload && input.samCutoutPng) refs.push({image_url:'data:image/png;base64,'+input.samCutoutPng.toString('base64')});
  if (refs.length) {
    return {endpoint:edits,body:{...body,images:refs}};
  }
  return { endpoint: generations, body };
}

function defaultImageFetch(url: string, init: MuseImageFetchInit): Promise<MuseImageFetchResponse> {
  return globalThis.fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
}

/**
 * Visual request prompt for one planned ad. Carries the planner's
 * visualPrompt plus product grounding and the no-text, no-branding,
 * no-fabrication constraints.
 */
export function buildMuseImagePrompt(plan: PlannedImageAd, input: ImageAdInput): string {
  if (process.env.SILKWEB_CREATIVE_DIRECTOR === 'on') {
    const choice = selectCreativeDirectorReferences(input).selections.find(s => s.audience === plan.audience);
    if (choice) {
      const visual = selectVisualStudyPairs(input).find(s => s.audience === plan.audience);
      return [
        buildDirectorImagePrompt(plan, input, choice),
        visual ? 'PRIMARY reference study: '+visual.referenceId+'. Original composition influenced by: '+visual.composition+'. Object handling: '+visual.productRelationship+'. Typography reference for later finishing ONLY: '+visual.typography+'. Never reproduce the exact study photograph, packaging, model, or brand.' : '',
      ].filter(Boolean).join('\n');
    }
  }
  const product = input.productName.length > 0 ? input.productName : 'the pictured product';
  const lines = [
    `Advertising photograph, vertical 4:5 portrait composition, 1080x1350: ${plan.visualPrompt}`,
    `Product: ${product}. Preserve the product appearance as closely as possible; do not invent branding or attributes.`,
    `Audience mood (${plan.audience}): ${plan.audience === 'cold' ? 'open, inviting discovery' : plan.audience === 'warm' ? 'considered, trustworthy evaluation' : 'decisive, clear call to action'}.`,
    'Photographic background with generous negative space for copy. No text, no words, no letters, no logos, no watermarks in the image.',
    buildBlueprintPhotoGuidance(plan.audience, input),
  ];
  if (input.upload) lines.push('Reference-guided: edit/compose using the supplied product photo as the visual reference.');
  else lines.push('No product photo supplied: generic premium setting, never a fabricated branded product close-up.');
  if (input.differentiator) lines.push(`Product note (do not render as text): ${input.differentiator}`);
  return lines.join('\n').slice(0, 4000);
}

function extractPngBytes(text: string): Buffer | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(record.data)) {
    for (const entry of record.data) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      candidates.push(e.b64_json, e.imageBase64, e.base64, e.pngDataUrl, e.dataUrl);
    }
  }
  candidates.push(record.b64_json, record.imageBase64, record.base64, record.pngDataUrl, record.dataUrl, record.image, record.result);
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    const base64 = candidate.includes(',')
      ? (candidate.split(',').pop() ?? '')
      : candidate;
    const compact = base64.replace(/\s+/g, '');
    if (compact.length === 0 || compact.length % 4 !== 0) continue;
    try {
      const bytes = Buffer.from(compact, 'base64');
      if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return bytes;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Real Muse Image 1.0 provider. Exactly one upstream POST per
 * generate() call, AbortSignal timeout, no retries. Returns raw PNG
 * bytes — dimensional verification happens in finishAdPng().
 */
export class MetaMuseImageProvider implements ImageGenerator {
  readonly name = 'meta-muse-image-1.0';
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly editsEndpoint: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: MuseImageFetchFn;

  constructor(options: MuseImageOptions = {}) {
    const env = options.env ?? process.env;
    this.apiKey = options.apiKey ?? resolveModelApiKey(env);
    this.endpoint = options.endpoint ?? MUSE_IMAGE_ENDPOINT;
    this.editsEndpoint = options.editsEndpoint;
    this.model = options.model ?? MUSE_IMAGE_MODEL;
    this.timeoutMs = options.timeoutMs ?? MUSE_IMAGE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? defaultImageFetch;
  }

  async generate(plan: PlannedImageAd, input: ImageAdInput): Promise<GeneratedImageBytes> {
    if (!this.apiKey) {
      throw new Error('Live image generation is not configured. Set SILKWEB_CREATIVE_PROVIDER=live with MODEL_API_KEY to enable it.');
    }
    const directorEnabled = process.env.SILKWEB_CREATIVE_DIRECTOR === 'on';
    const assetRoot = process.env.SILKWEB_APPROVED_SCENE_DIR;
    const match = directorEnabled && assetRoot
      ? selectVisualStudyPairs(input).find(s=>s.audience===plan.audience)
      : undefined;
    const scene = match && assetRoot
      ? await loadApprovedSceneAsset(match.referenceId,assetRoot)
      : null;
    const referenceGuided = Boolean(input.upload || scene);
    const request = buildMuseImageRequest(plan, input, {
      endpoint: this.endpoint,
      editsEndpoint: this.editsEndpoint,
      model: this.model,
      approvedSceneDataUrl: scene?.dataUrl,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: MuseImageFetchResponse;
    try {
      response = await this.fetchImpl(request.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Muse Image request timed out after ${this.timeoutMs}ms.`);
      throw new Error('Muse Image network request failed (UNKNOWN_NETWORK_ERROR).');
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_IMAGE_RESPONSE_BYTES) {
      throw new Error(`Muse Image response exceeds the ${MAX_IMAGE_RESPONSE_BYTES}-byte limit.`);
    }
    if (!response.ok) {
      throw new Error(`Muse Image API error: HTTP ${response.status} ${text.trim().slice(0, 200)}`.slice(0, 400));
    }
    const png = extractPngBytes(text);
    if (!png) throw new Error('Muse Image response contained no PNG image data.');
    return { png, referenceGuided };
  }
}

export interface FinishIssue {
  field: string;
  message: string;
}

/** Neutral letterbox fill for contain-fitting (matches the SilkWeb paper background). */
export const FINISH_BACKGROUND: [number, number, number] = [252, 251, 248];

/**
 * Bilinear resample of decoded RGBA pixels into a 1080 x 1350 frame using
 * contain-fit: the whole provider image is preserved at the largest size
 * that fits, centered over the neutral background. Aspect-ratio differences
 * are therefore handled deliberately with visible padding — never by
 * stretching the product and never by silently cropping details.
 */
export function fitPhotoToAdFrame(photo: { width: number; height: number; pixels: Buffer }): { width: number; height: number; pixels: Buffer } {
  const scale = Math.min(IMAGE_AD_WIDTH / photo.width, IMAGE_AD_HEIGHT / photo.height);
  const scaledW = Math.max(1, Math.round(photo.width * scale));
  const scaledH = Math.max(1, Math.round(photo.height * scale));
  const dx = Math.round((IMAGE_AD_WIDTH - scaledW) / 2);
  const dy = Math.round((IMAGE_AD_HEIGHT - scaledH) / 2);
  const pixels = Buffer.alloc(IMAGE_AD_WIDTH * IMAGE_AD_HEIGHT * 4);
  for (let i = 0; i < IMAGE_AD_WIDTH * IMAGE_AD_HEIGHT; i += 1) {
    pixels[i * 4] = FINISH_BACKGROUND[0];
    pixels[i * 4 + 1] = FINISH_BACKGROUND[1];
    pixels[i * 4 + 2] = FINISH_BACKGROUND[2];
    pixels[i * 4 + 3] = 255;
  }
  const sample = (sx: number, sy: number, channel: number): number => {
    const x0 = Math.max(0, Math.min(photo.width - 1, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(photo.height - 1, Math.floor(sy)));
    const x1 = Math.max(0, Math.min(photo.width - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(photo.height - 1, y0 + 1));
    const fx = Math.max(0, Math.min(1, sx - x0));
    const fy = Math.max(0, Math.min(1, sy - y0));
    const a = photo.pixels[(y0 * photo.width + x0) * 4 + channel];
    const b = photo.pixels[(y0 * photo.width + x1) * 4 + channel];
    const c = photo.pixels[(y1 * photo.width + x0) * 4 + channel];
    const d = photo.pixels[(y1 * photo.width + x1) * 4 + channel];
    return Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
  };
  for (let y = 0; y < scaledH; y += 1) {
    for (let x = 0; x < scaledW; x += 1) {
      const sx = (x + 0.5) / scale - 0.5;
      const sy = (y + 0.5) / scale - 0.5;
      const di = ((dy + y) * IMAGE_AD_WIDTH + (dx + x)) * 4;
      const alpha = sample(sx, sy, 3) / 255;
      pixels[di] = Math.round(sample(sx, sy, 0) * alpha + pixels[di] * (1 - alpha));
      pixels[di + 1] = Math.round(sample(sx, sy, 1) * alpha + pixels[di + 1] * (1 - alpha));
      pixels[di + 2] = Math.round(sample(sx, sy, 2) * alpha + pixels[di + 2] * (1 - alpha));
      pixels[di + 3] = 255;
    }
  }
  return { width: IMAGE_AD_WIDTH, height: IMAGE_AD_HEIGHT, pixels };
}

/**
 * Image finishing for provider bytes. The `size` parameter only requests an
 * aspect ratio, so valid provider output arrives at the generator's own
 * resolution: any decodable PNG within the pixel cap is accepted and
 * contain-fitted to a verified 1080 x 1350 PNG data URL — no distortion,
 * no silent cropping. Exact-size bytes pass through verbatim. Malformed or
 * unsupported data fails verification. No bitmap-font overlay and no
 * SilkWeb branding are ever added; ad copy travels as validated structured
 * text rendered by the browser.
 */
export function finishAdPng(
  png: Buffer,
  field = 'png',
): { ok: true; pngDataUrl: string; width: number; height: number; fitted: boolean } | { ok: false; issues: FinishIssue[] } {
  if (!Buffer.isBuffer(png) || png.length === 0) {
    return { ok: false, issues: [{ field, message: 'Image is empty.' }] };
  }
  const decoded = decodePng(png);
  if (!decoded) {
    return { ok: false, issues: [{ field, message: 'Image is not a supported PNG file.' }] };
  }
  if (decoded.width <= 0 || decoded.height <= 0 || decoded.width * decoded.height > 16_000_000) {
    return { ok: false, issues: [{ field, message: 'Image dimensions are not supported.' }] };
  }
  if (decoded.width === IMAGE_AD_WIDTH && decoded.height === IMAGE_AD_HEIGHT) {
    return { ok: true, pngDataUrl: `data:image/png;base64,${png.toString('base64')}`, width: decoded.width, height: decoded.height, fitted: false };
  }
  const frame = fitPhotoToAdFrame(decoded);
  const out = encodePng(frame);
  return { ok: true, pngDataUrl: `data:image/png;base64,${out.toString('base64')}`, width: IMAGE_AD_WIDTH, height: IMAGE_AD_HEIGHT, fitted: true };
}
