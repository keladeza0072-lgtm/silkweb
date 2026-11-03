import sharp from 'sharp';
import {
  IMAGE_AD_WIDTH,
  IMAGE_AD_HEIGHT,
} from './imageAds.js';
import {
  blueprintForClass,
  validateBlueprint,
  type Region,
} from './imageAdBlueprint.js';
import type { CreativeClassId } from './creativeReferenceRegistry.js';
import type { FinishCopy } from './imageAdFinishTypes.js';

const W = IMAGE_AD_WIDTH;
const H = IMAGE_AD_HEIGHT;

function escapeXml(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function px(r: Region) {
  return {
    x: Math.round(r.x * W),
    y: Math.round(r.y * H),
    w: Math.round(r.w * W),
    h: Math.round(r.h * H),
  };
}

function widthEstimate(s: string, size: number): number {
  return [...s].reduce((n, ch) =>
    n + size * (ch === ' ' ? .33 : /[ilI.,!]/.test(ch) ? .28 : /[MW@]/.test(ch) ? .9 : .57), 0);
}

function fitLines(text: string, width: number, height: number, maxLines: number, minSize: number, maxSize: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);

  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines: string[] = [];
    let current = '';
    let impossible = false;

    for (const word of words) {
      if (widthEstimate(word, size) > width) {
        impossible = true;
        break;
      }

      const next = current ? `${current} ${word}` : word;
      if (widthEstimate(next, size) <= width) current = next;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }

    if (current) lines.push(current);

    const lineHeight = size * 1.18;
    if (!impossible && lines.length <= maxLines && lines.length * lineHeight <= height) {
      return { lines, size, lineHeight };
    }
  }

  return null;
}

function renderText(text: string, region: Region, options: {
  minSize: number;
  maxSize: number;
  maxLines: number;
  weight: number;
  fill: string;
}): string | null {
  const box = px(region);
  const fit = fitLines(text, box.w, box.h, options.maxLines, options.minSize, options.maxSize);
  if (!fit) return null;

  return fit.lines.map((line, i) =>
    `<text x="${box.x}" y="${Math.round(box.y + fit.size + i * fit.lineHeight)}"` +
    ` font-family="Segoe UI,Arial,sans-serif" font-size="${fit.size}"` +
    ` font-weight="${options.weight}" fill="${options.fill}">${escapeXml(line)}</text>`
  ).join('');
}

export async function renderBlueprintAd(
  png: Buffer,
  copy: FinishCopy,
  creativeClass: CreativeClassId,
): Promise<{ ok: true; pngDataUrl: string; width: number; height: number } |
           { ok: false; reason: string }> {
  const blueprint = blueprintForClass(creativeClass);

  if (!blueprint) return { ok: false, reason: 'Unsupported composition blueprint.' };
  if (validateBlueprint(blueprint).length) return { ok: false, reason: 'Invalid composition blueprint.' };

  const headline = renderText(copy.headline, blueprint.headline, {
    minSize: blueprint.headlineMinFontPx,
    maxSize: blueprint.headlineMaxFontPx,
    maxLines: blueprint.headlineMaxLines,
    weight: 700,
    fill: '#172238',
  });

  const body = renderText(copy.body, blueprint.body, {
    minSize: 22,
    maxSize: 36,
    maxLines: 5,
    weight: 400,
    fill: '#596273',
  });

  if (!headline || !body) {
    return { ok: false, reason: 'Approved copy does not fit composition safely.' };
  }

  try {
    const meta = await sharp(png).metadata();
    if (meta.format !== 'png' || !meta.width || !meta.height ||
        meta.width * meta.height > 16_000_000) {
      return { ok: false, reason: 'Unsupported PNG input.' };
    }

    // Semi-opaque text surfaces protect readability while leaving the
    // reserved product region free from these overlays.
    const blocks = [blueprint.headline, blueprint.body].map(r => {
      const b = px(r);
      return `<rect x="${b.x - 8}" y="${b.y - 5}" width="${b.w + 16}" height="${b.h + 10}"
             rx="10" fill="#F8F7F5" fill-opacity=".96"/>`;
    }).join('');

    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      blocks + headline + body + '</svg>',
    );

    const output = await sharp(png)
      .resize(W, H, { fit: 'contain', background: '#F8F7F5' })
      .composite([{ input: svg, left: 0, top: 0 }])
      .png().toBuffer();

    return {
      ok: true,
      pngDataUrl: `data:image/png;base64,${output.toString('base64')}`,
      width: W,
      height: H,
    };
  } catch {
    return { ok: false, reason: 'Image finishing failed.' };
  }
}
