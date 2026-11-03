/**
 * SilkWeb Creative — Sharp-based image ad finishing.
 * Original photography, real SVG typography, deterministic layouts.
 * No model calls, network requests, or customer-facing style controls.
 */
import sharp from 'sharp';
import {
  IMAGE_AD_WIDTH,
  IMAGE_AD_HEIGHT,
} from './imageAds.js';
import type {
  FinishAudience,
  FinishCopy,
  FinishLayout,
} from './imageAdFinishTypes.js';
import { compositionForAudience } from './imageAdComposition.js';
import type { CreativeClassId } from './creativeReferenceRegistry.js';

type FinishResult =
  | {
      ok: true;
      pngDataUrl: string;
      width: number;
      height: number;
      layout: FinishLayout;
    }
  | {
      ok: false;
      issues: { field: string; message: string }[];
    };

const WIDTH = IMAGE_AD_WIDTH;
const HEIGHT = IMAGE_AD_HEIGHT;
const INK = '#172238';
const PAPER = '#F8F7F5';
const MUTED = '#596273';
const WHITE = '#FFFFFF';

function xml(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Conservative width estimate. Final text stays within a fixed panel. */
function estimatedWidth(value: string, fontSize: number): number {
  let units = 0;
  for (const ch of value) {
    if (' ilI.,:;!|'.includes(ch)) units += 0.28;
    else if ('MW@%'.includes(ch)) units += 0.9;
    else if (ch === ' ') units += 0.34;
    else units += 0.56;
  }
  return units * fontSize;
}

function wrap(
  value: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const original of words) {
    let word = original;
    while (estimatedWidth(word, fontSize) > maxWidth && word.length > 1) {
      let count = word.length - 1;
      while (count > 1 && estimatedWidth(word.slice(0, count), fontSize) > maxWidth) {
        count--;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, Math.max(1, count)));
      word = word.slice(Math.max(1, count));
    }

    if (!word) continue;
    const next = line ? `${line} ${word}` : word;
    if (estimatedWidth(next, fontSize) <= maxWidth) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);

  if (lines.length <= maxLines) return lines;
  const shown = lines.slice(0, maxLines);
  let last = shown[maxLines - 1];
  while (last.length > 1 && estimatedWidth(`${last}…`, fontSize) > maxWidth) {
    last = last.slice(0, -1);
  }
  shown[maxLines - 1] = `${last}…`;
  return shown;
}

function textLines(
  value: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  lineHeight: number,
  maxLines: number,
  color: string,
  weight: number,
): string {
  const lines = wrap(value, width, fontSize, maxLines);
  return lines.map((line, i) =>
    `<text x="${x}" y="${y + i * lineHeight}" ` +
    `font-family="Segoe UI, Arial, sans-serif" ` +
    `font-size="${fontSize}" font-weight="${weight}" ` +
    `fill="${color}">${xml(line)}</text>`
  ).join('');
}

function button(label: string, x: number, y: number, dark: boolean): string {
  let short = label.trim();
  while (estimatedWidth(short, 34) > 278 && short.length > 1) {
    short = short.slice(0, -1);
  }
  if (short !== label.trim()) short = `${short.trimEnd()}…`;

  const bg = dark ? WHITE : INK;
  const fg = dark ? INK : WHITE;
  return `
    <rect x="${x}" y="${y}" width="370" height="96"
          rx="24" fill="${bg}"/>
    <text x="${x + 185}" y="${y + 61}" text-anchor="middle"
          font-family="Segoe UI, Arial, sans-serif"
          font-size="34" font-weight="700"
          fill="${fg}">${xml(short)}</text>`;
}

/**
 * Reference-guided compositions.
 *
 * These treatments use validated planned copy only. They do not create
 * additional product claims, testimonials, offers, or feature annotations.
 * The default audience layouts remain available as a fallback.
 */
function creativeOverlay(
  copy: FinishCopy,
  creativeClass: CreativeClassId,
): Buffer | null {
  let content: string;

  switch (creativeClass) {
    case 'OUTCOME_HERO':
      content = `
        <rect width="${WIDTH}" height="410" fill="#F8F7F5"/>
        <rect x="72" y="65" width="96" height="7" rx="3" fill="#596273"/>
        ${textLines(copy.headline, 72, 161, 936, 82, 92, 2, INK, 700)}
        ${textLines(copy.body, 72, 344, 936, 34, 46, 1, MUTED, 400)}
        <rect x="48" y="1150" width="420" height="142" rx="29" fill="#F8F7F5"/>
        ${button(copy.cta, 74, 1173, false)}`;
      break;

    case 'BENEFIT_STACK':
      content = `
        <rect width="490" height="${HEIGHT}" fill="#F8F7F5"/>
        <rect x="58" y="80" width="68" height="7" rx="3" fill="#596273"/>
        ${textLines(copy.headline, 58, 188, 372, 62, 74, 4, INK, 700)}
        <rect x="58" y="600" width="374" height="2" fill="#D8DCE0"/>
        ${textLines(copy.body, 58, 680, 372, 31, 44, 5, MUTED, 400)}
        ${button(copy.cta, 58, 1168, false)}`;
      break;

    case 'ANNOTATED_HERO':
      content = `
        <rect width="${WIDTH}" height="268" fill="#F8F7F5"/>
        ${textLines(copy.headline, 72, 125, 936, 65, 74, 2, INK, 700)}
        <rect x="540" y="1000" width="488" height="290" rx="24"
              fill="#F8F7F5"/>
        <rect x="574" y="1037" width="65" height="6" rx="3" fill="#596273"/>
        ${textLines(copy.body, 574, 1101, 414, 29, 41, 2, INK, 400)}
        ${button(copy.cta, 574, 1170, false)}`;
      break;

    case 'OFFER_HERO':
      content = `
        <rect width="${WIDTH}" height="352" fill="#172238"/>
        <rect x="60" y="57" width="9" height="238" rx="4" fill="#FFFFFF"/>
        ${textLines(copy.headline, 98, 148, 880, 76, 89, 2, WHITE, 700)}
        ${textLines(copy.body, 98, 297, 880, 33, 44, 1, WHITE, 400)}
        <rect x="48" y="1150" width="420" height="142" rx="29" fill="#172238"/>
        ${button(copy.cta, 74, 1173, true)}`;
      break;

    default:
      return null;
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}"
     height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    content + '</svg>',
    'utf8',
  );
}
function overlay(copy: FinishCopy, layout: FinishLayout, renderEmbeddedCta = true): Buffer {
  let content = '';

  if (layout === 'discovery') {
    content = `
      <rect width="${WIDTH}" height="424" fill="${PAPER}"/>
      ${textLines(copy.headline, 72, 148, 936, 74, 86, 2, INK, 700)}
      ${textLines(copy.body, 72, 334, 936, 35, 49, 2, MUTED, 400)}
      ${renderEmbeddedCta ? '<rect x="52" y="1148" width="418" height="142" rx="30" fill="${PAPER}"/>' : ''}
      ${renderEmbeddedCta ? button(copy.cta, 76, 1171, false) : ""}`;
  } else if (layout === 'consideration') {
    content = `
      <rect y="748" width="${WIDTH}" height="602" fill="${INK}"/>
      ${textLines(copy.headline, 72, 853, 936, 69, 81, 2, WHITE, 700)}
      ${textLines(copy.body, 72, 1039, 936, 34, 48, 2, WHITE, 400)}
      ${renderEmbeddedCta ? button(copy.cta, 72, 1186, true) : ""}`;
  } else {
    content = `
      <rect y="790" width="${WIDTH}" height="560" fill="${INK}"/>
      ${textLines(copy.headline, 72, 891, 936, 68, 80, 2, WHITE, 700)}
      ${textLines(copy.body, 72, 1064, 936, 33, 47, 2, WHITE, 400)}
      ${renderEmbeddedCta ? button(copy.cta, 72, 1191, true) : ""}`;
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    content + '</svg>',
    'utf8',
  );
}

export async function finishLiveAdPngSharp(
  png: Buffer,
  copy: FinishCopy,
  audience: FinishAudience,
  field = 'png',
  creativeClass?: CreativeClassId,
  renderEmbeddedCta = true,
): Promise<FinishResult> {
  if (!Buffer.isBuffer(png) || png.length === 0) {
    return { ok: false, issues: [{ field, message: 'Image is empty.' }] };
  }

  try {
    const metadata = await sharp(png).metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 16_000_000
    ) {
      return { ok: false, issues: [{ field, message: 'Image is not a supported PNG file.' }] };
    }

    const preset = compositionForAudience(audience);
    const layout: FinishLayout =
      preset.id === 'EDITORIAL_DISCOVERY' ? 'discovery' :
      preset.id === 'CONTEXTUAL_SPOTLIGHT' ? 'consideration' :
      'action';

    const output = await sharp(png)
      .resize(WIDTH, HEIGHT, {
        fit: 'contain',
        background: PAPER,
      })
      .composite([{ input: creativeClass ? (creativeOverlay(copy, creativeClass) ?? overlay(copy, layout, renderEmbeddedCta)) : overlay(copy, layout, renderEmbeddedCta), left: 0, top: 0 }])
      .png()
      .toBuffer();

    const verified = await sharp(output).metadata();
    if (verified.width !== WIDTH || verified.height !== HEIGHT || verified.format !== 'png') {
      return { ok: false, issues: [{ field, message: 'Finished PNG verification failed.' }] };
    }

    return {
      ok: true,
      pngDataUrl: `data:image/png;base64,${output.toString('base64')}`,
      width: WIDTH,
      height: HEIGHT,
      layout,
    };
  } catch {
    return {
      ok: false,
      issues: [{ field, message: 'Image finishing failed.' }],
    };
  }
}
