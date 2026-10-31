/**
 * SilkWeb Image Ads — Milestone 1 offline engine.
 *
 * Deterministic and dependency-free: three differentiated creative
 * specifications plus a real 1080 x 1350 PNG renderer built on the
 * hand-authored bitmap font. No model calls, no stock assets, no
 * invented discounts, endorsements, testimonials, or results.
 * Copy uses only the supplied product name and campaign objective.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { fitScale, fontSafe, glyphFor, GLYPH_HEIGHT, measureBlock, measureLine } from './font.js';

export const IMAGE_AD_WIDTH = 1080;
export const IMAGE_AD_HEIGHT = 1350;

/** Route body cap: three PNG data URLs never travel inbound, one upload may. */
export const IMAGE_ADS_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Largest accepted product-image upload after base64 decoding. */
export const IMAGE_ADS_MAX_IMAGE_BYTES = 1536 * 1024;
/** Largest decodable photo in pixels (bounds memory/time). */
export const IMAGE_ADS_MAX_PHOTO_PIXELS = 16_000_000;

export const IMAGE_AD_SUPPORTED_FORMATS = ['PNG', 'JPEG', 'WebP'] as const;

export interface ImageAdObjective {
  id: 'drive-sales' | 'build-awareness' | 'launch-product';
  name: string;
  blurb: string;
}

export const IMAGE_AD_OBJECTIVES: readonly ImageAdObjective[] = [
  { id: 'drive-sales', name: 'Drive Sales', blurb: 'Turn interest into orders.' },
  { id: 'build-awareness', name: 'Build Awareness', blurb: 'Introduce the product widely.' },
  { id: 'launch-product', name: 'Launch a Product', blurb: 'Announce something new.' },
];

export const IMAGE_AD_DEFAULT_OBJECTIVE = 'drive-sales' as const;

export function imageAdObjectiveIds(): string[] {
  return IMAGE_AD_OBJECTIVES.map((o) => o.id);
}

export interface ImageAdSpec {
  id: string;
  direction: string;
  angle: string;
  headline: string;
  body: string;
  cta: string;
  layout: 'editorial' | 'bold' | 'warm';
}

export interface ImageAdResult extends ImageAdSpec {
  width: number;
  height: number;
  pngDataUrl: string;
  photoComposited: boolean;
}

export interface ImageAdIssue {
  field: string;
  message: string;
}

interface ParsedUpload {
  format: 'png' | 'jpeg' | 'webp';
  bytes: Buffer;
}

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,([\s\S]+)$/i;

function sniffFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Parse and sniff a product-image data URL. Returns issues when unusable. */
export function parseProductImage(value: unknown): { upload: ParsedUpload | null; issues: ImageAdIssue[] } {
  if (value === undefined || value === null || value === '') {
    return { upload: null, issues: [] };
  }
  if (typeof value !== 'string') {
    return { upload: null, issues: [{ field: 'productImage', message: 'Product image must be a data URL string.' }] };
  }
  const match = DATA_URL_PATTERN.exec(value.trim());
  if (!match) {
    return {
      upload: null,
      issues: [{ field: 'productImage', message: 'Product image must be a PNG, JPEG, or WebP data URL.' }],
    };
  }
  const declared = match[1].toLowerCase().replace('jpg', 'jpeg');
  const compact = match[2].replace(/\s+/g, '');
  if (compact.length === 0 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    return { upload: null, issues: [{ field: 'productImage', message: 'Product image is not valid base64.' }] };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(compact, 'base64');
  } catch {
    return { upload: null, issues: [{ field: 'productImage', message: 'Product image is not valid base64.' }] };
  }
  if (bytes.length === 0) {
    return { upload: null, issues: [{ field: 'productImage', message: 'Product image is empty.' }] };
  }
  if (bytes.length > IMAGE_ADS_MAX_IMAGE_BYTES) {
    return {
      upload: null,
      issues: [{ field: 'productImage', message: 'Product image must be 1.5 MB or smaller.' }],
    };
  }
  const sniffed = sniffFormat(bytes);
  if (!sniffed) {
    return {
      upload: null,
      issues: [{ field: 'productImage', message: 'Product image bytes are not a PNG, JPEG, or WebP file.' }],
    };
  }
  if (sniffed !== declared) {
    return {
      upload: null,
      issues: [{ field: 'productImage', message: 'Product image content does not match its declared format.' }],
    };
  }
  return { upload: { format: sniffed, bytes }, issues: [] };
}

export interface ImageAdInput {
  productName: string;
  objective: ImageAdObjective['id'];
  upload: ParsedUpload | null;
  /** Optional Milestone 2 details (collapsed in the UI, all user-supplied). */
  differentiator: string;
  price: string;
  currency: string;
  specialOffer: string;
}

/** Optional-field length caps for Milestone 2 details. */
export const IMAGE_AD_DETAILS_LIMITS = {
  differentiator: 200,
  price: 40,
  currency: 8,
  specialOffer: 200,
} as const;

export function validateImageAdInput(body: unknown): { ok: true; input: ImageAdInput } | { ok: false; issues: ImageAdIssue[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, issues: [{ field: 'body', message: 'Ad request must be a JSON object.' }] };
  }
  const record = body as Record<string, unknown>;
  const issues: ImageAdIssue[] = [];

  const rawName = typeof record.productName === 'string' ? record.productName.trim() : '';
  if (rawName.length > 120) {
    issues.push({ field: 'productName', message: 'Product name must be 120 characters or fewer.' });
  }
  const { upload, issues: uploadIssues } = parseProductImage(record.productImage);
  issues.push(...uploadIssues);

  if (rawName.length === 0 && !upload) {
    issues.push({ field: 'productName', message: 'Provide a product image or a product name.' });
  }
  if (typeof record.objective !== 'string' || !imageAdObjectiveIds().includes(record.objective)) {
    issues.push({ field: 'objective', message: 'Choose a campaign objective: drive-sales, build-awareness, or launch-product.' });
  }

  const optionalText = (field: 'differentiator' | 'price' | 'currency' | 'specialOffer'): string => {
    const raw = record[field];
    if (raw === undefined || raw === null || raw === '') return '';
    if (typeof raw !== 'string') {
      issues.push({ field, message: `${field} must be a string.` });
      return '';
    }
    const trimmed = raw.trim();
    if (trimmed.length > IMAGE_AD_DETAILS_LIMITS[field]) {
      issues.push({ field, message: `${field} must be ${IMAGE_AD_DETAILS_LIMITS[field]} characters or fewer.` });
    }
    return trimmed;
  };
  const differentiator = optionalText('differentiator');
  const price = optionalText('price');
  const currency = optionalText('currency');
  const specialOffer = optionalText('specialOffer');
  if (price.length > 0 && !/^[0-9][0-9.,\s]*$/.test(price)) {
    issues.push({ field: 'price', message: 'Price must be a plain amount such as 49 or 49.99.' });
  }
  if (currency.length > 0 && !/^[A-Za-z$€£¥₹]{1,8}$/.test(currency)) {
    issues.push({ field: 'currency', message: 'Currency must be a short code or symbol such as USD or $.' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    input: {
      productName: rawName,
      objective: record.objective as ImageAdInput['objective'],
      upload,
      differentiator,
      price,
      currency,
      specialOffer,
    },
  };
}

interface CopyDeck {
  headline: string;
  body: string;
  cta: string;
}

/**
 * Claim-free copy decks: every line is either the supplied product
 * name, a neutral invitation, or a CTA with no offer attached.
 * Three genuinely different angles per objective.
 */
const COPY_DECKS: Record<ImageAdObjective['id'], { angle: string; deck: (product: string) => CopyDeck }[]> = {
  'drive-sales': [
    {
      angle: 'Direct product focus — look closely, then shop.',
      deck: (p) => ({
        headline: `Take another look at ${p}.`,
        body: `See ${p} up close, and decide for yourself.`,
        cta: 'Shop now',
      }),
    },
    {
      angle: 'Confident statement — the product is ready when they are.',
      deck: (p) => ({
        headline: `Your ${p} is waiting.`,
        body: `Find ${p} today, ready when you are.`,
        cta: 'Order today',
      }),
    },
    {
      angle: 'Warm introduction — meet the product by name.',
      deck: (p) => ({
        headline: `Meet ${p}.`,
        body: `A closer look at ${p} — then the choice is yours.`,
        cta: 'Get yours',
      }),
    },
  ],
  'build-awareness': [
    {
      angle: 'Curious question — start the conversation.',
      deck: (p) => ({
        headline: `Have you met ${p}?`,
        body: `Get to know ${p} — what it is, and what it is for.`,
        cta: 'Learn more',
      }),
    },
    {
      angle: 'Story framing — the product has people to find.',
      deck: (p) => ({
        headline: `The story of ${p} starts here.`,
        body: `Follow along as ${p} finds its people.`,
        cta: 'Discover more',
      }),
    },
    {
      angle: 'Spotlight framing — a first introduction.',
      deck: (p) => ({
        headline: `${p}, in the spotlight.`,
        body: `A first introduction to ${p} — more to come.`,
        cta: 'Follow the story',
      }),
    },
  ],
  'launch-product': [
    {
      angle: 'Classic announcement — introduce by name.',
      deck: (p) => ({
        headline: `Introducing ${p}.`,
        body: `Be among the first to see ${p} up close.`,
        cta: 'Explore the launch',
      }),
    },
    {
      angle: 'Arrival framing — the wait is over.',
      deck: (p) => ({
        headline: `${p} has arrived.`,
        body: `The wait is over — come and see ${p}.`,
        cta: 'Be first in line',
      }),
    },
    {
      angle: 'Friendly greeting — say hello.',
      deck: (p) => ({
        headline: `Say hello to ${p}.`,
        body: `New on the scene: ${p}. Take the first look.`,
        cta: `Meet ${p}`,
      }),
    },
  ],
};

const DIRECTIONS = [
  { direction: 'Editorial light', layout: 'editorial' as const },
  { direction: 'Bold ink', layout: 'bold' as const },
  { direction: 'Warm centered', layout: 'warm' as const },
];

/* ------------------------------------------------------------------ */
/* Framebuffer and drawing primitives                                 */
/* ------------------------------------------------------------------ */

export type RGB = [number, number, number];

export const BRAND: Record<'paper' | 'ink' | 'orange' | 'warm' | 'line' | 'mutedLight' | 'mutedDark' | 'inkSoft', RGB> = {
  paper: [252, 251, 248],
  ink: [23, 34, 53],
  orange: [255, 90, 10],
  warm: [255, 242, 233],
  line: [232, 231, 227],
  mutedLight: [91, 100, 114],
  mutedDark: [199, 206, 218],
  inkSoft: [38, 51, 74],
};

export interface Frame {
  width: number;
  height: number;
  pixels: Buffer;
}

export function createFrame(width: number, height: number, bg: RGB): Frame {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = bg[0];
    pixels[i * 4 + 1] = bg[1];
    pixels[i * 4 + 2] = bg[2];
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, pixels };
}

export function setPixel(frame: Frame, x: number, y: number, color: RGB): void {
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
  const i = (y * frame.width + x) * 4;
  frame.pixels[i] = color[0];
  frame.pixels[i + 1] = color[1];
  frame.pixels[i + 2] = color[2];
}

export function fillRect(frame: Frame, x: number, y: number, w: number, h: number, color: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(frame.width, Math.ceil(x + w));
  const y1 = Math.min(frame.height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    for (let xx = x0; xx < x1; xx += 1) {
      setPixel(frame, xx, yy, color);
    }
  }
}

/** Filled rounded rectangle (pill when radius >= height / 2). */
export function fillRoundRect(frame: Frame, x: number, y: number, w: number, h: number, r: number, color: RGB): void {
  const radius = Math.min(r, w / 2, h / 2);
  fillRect(frame, x + radius, y, w - radius * 2, h, color);
  fillRect(frame, x, y + radius, w, h - radius * 2, color);
  const corners: [number, number][] = [
    [x + radius, y + radius],
    [x + w - radius, y + radius],
    [x + radius, y + h - radius],
    [x + w - radius, y + h - radius],
  ];
  for (const [cx, cy] of corners) {
    const x0 = Math.floor(cx - radius);
    const x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius);
    const y1 = Math.ceil(cy + radius);
    for (let yy = y0; yy <= y1; yy += 1) {
      for (let xx = x0; xx <= x1; xx += 1) {
        if ((xx - cx + 0.5) ** 2 + (yy - cy + 0.5) ** 2 <= radius * radius) {
          setPixel(frame, xx, yy, color);
        }
      }
    }
  }
}

/** Even-odd scanline fill for a simple polygon. */
function fillPolygon(frame: Frame, points: [number, number][], color: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, py] of points) {
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x += 1) {
        setPixel(frame, x, y, color);
      }
    }
  }
}

/** Bethlehem-style four-point sparkle used as the SilkWeb mark. */
export function drawStar(frame: Frame, cx: number, cy: number, size: number, color: RGB): void {
  const s = size / 2;
  const pinch = 0.16;
  fillPolygon(
    frame,
    [
      [cx, cy - s],
      [cx + s * pinch, cy - s * pinch],
      [cx + s, cy],
      [cx + s * pinch, cy + s * pinch],
      [cx, cy + s],
      [cx - s * pinch, cy + s * pinch],
      [cx - s, cy],
      [cx - s * pinch, cy - s * pinch],
    ],
    color,
  );
}

export function drawGlyph(frame: Frame, char: string, x: number, y: number, scale: number, color: RGB): void {
  const rows = glyphFor(char);
  for (let gy = 0; gy < GLYPH_HEIGHT; gy += 1) {
    const row = rows[gy];
    for (let gx = 0; gx < row.length; gx += 1) {
      if (row[gx] !== '#') continue;
      fillRect(frame, x + gx * scale, y + gy * scale, scale, scale, color);
    }
  }
}

export interface DrawnText {
  widthPx: number;
  heightPx: number;
}

export function drawLine(
  frame: Frame,
  text: string,
  x: number,
  y: number,
  scale: number,
  tracking: number,
  color: RGB,
  align: 'left' | 'center' = 'left',
): DrawnText {
  const safe = fontSafe(text);
  const widthPx = measureLine(safe, scale, tracking);
  let cursor = align === 'center' ? Math.round(x - widthPx / 2) : Math.round(x);
  const top = Math.round(y);
  for (const char of safe) {
    drawGlyph(frame, char, cursor, top, scale, color);
    cursor += 5 * scale + tracking;
  }
  return { widthPx, heightPx: 7 * scale };
}

export function drawLines(
  frame: Frame,
  lines: string[],
  x: number,
  y: number,
  scale: number,
  tracking: number,
  lineGap: number,
  color: RGB,
  align: 'left' | 'center' = 'left',
): number {
  let cursor = Math.round(y);
  for (const line of lines) {
    drawLine(frame, line, x, cursor, scale, tracking, color, align);
    cursor += 7 * scale + lineGap;
  }
  return cursor - lineGap;
}

/* ------------------------------------------------------------------ */
/* Minimal PNG codec (8-bit RGB/RGBA, non-interlaced)                 */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** Encode an RGBA frame as a PNG Buffer (alpha is dropped: RGB output). */
export function encodePng(frame: Frame): Buffer {
  const { width, height, pixels } = frame;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + width * 3) + 1 + x * 3;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(parts);
}

export interface DecodedPhoto {
  width: number;
  height: number;
  pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode an 8-bit non-interlaced RGB/RGBA PNG into RGBA pixels.
 * Returns null for anything outside that supported subset.
 */
export function decodePng(bytes: Buffer): DecodedPhoto | null {
  if (bytes.length < 33) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  let offset = 8;
  let seenIhdr = false;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length || offset + 12 + length > bytes.length) return null;
    const stored = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== stored) return null;
    if (type === 'IHDR') {
      if (seenIhdr || length !== 13) return null;
      seenIhdr = true;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || (data[9] !== 2 && data[9] !== 6) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        return null;
      }
      colorType = data[9];
      if (width <= 0 || height <= 0 || width * height > IMAGE_ADS_MAX_PHOTO_PIXELS) return null;
    } else if (type === 'IDAT') {
      if (!seenIhdr) return null;
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!seenIhdr || idat.length === 0) return null;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length !== height * (stride + 1)) return null;
  const pixels = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) return null;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) value = (value + paeth(a, b, c)) & 0xff;
      current[i] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      pixels[dst] = current[x * channels];
      pixels[dst + 1] = current[x * channels + 1];
      pixels[dst + 2] = current[x * channels + 2];
      pixels[dst + 3] = channels === 4 ? current[x * channels + 3] : 255;
    }
    prev.set(current);
  }
  return { width, height, pixels };
}

/**
 * Cover-fit a photo into a box with nearest-neighbor sampling,
 * composited over the frame (honors source alpha).
 */
export function drawPhotoCover(frame: Frame, photo: DecodedPhoto, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / photo.width, h / photo.height);
  const srcW = w / scale;
  const srcH = h / scale;
  const srcX = (photo.width - srcW) / 2;
  const srcY = (photo.height - srcH) / 2;
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(frame.width, Math.ceil(x + w));
  const y1 = Math.min(frame.height, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    const sy = Math.min(photo.height - 1, Math.max(0, Math.floor(srcY + (yy - y) / scale)));
    for (let xx = x0; xx < x1; xx += 1) {
      const sx = Math.min(photo.width - 1, Math.max(0, Math.floor(srcX + (xx - x) / scale)));
      const si = (sy * photo.width + sx) * 4;
      const alpha = photo.pixels[si + 3] / 255;
      const di = (yy * frame.width + xx) * 4;
      frame.pixels[di] = Math.round(photo.pixels[si] * alpha + frame.pixels[di] * (1 - alpha));
      frame.pixels[di + 1] = Math.round(photo.pixels[si + 1] * alpha + frame.pixels[di + 1] * (1 - alpha));
      frame.pixels[di + 2] = Math.round(photo.pixels[si + 2] * alpha + frame.pixels[di + 2] * (1 - alpha));
    }
  }
}

/** Build the three differentiated creative specifications for an input. */
export function buildImageAdSpecs(input: ImageAdInput): ImageAdSpec[] {
  const product = input.productName.length > 0 ? input.productName : 'Something new';
  const decks = COPY_DECKS[input.objective];
  return decks.map((entry, index) => {
    const copy = entry.deck(product);
    return {
      id: `ad-${index + 1}`,
      direction: DIRECTIONS[index].direction,
      angle: entry.angle,
      headline: copy.headline,
      body: copy.body,
      cta: copy.cta,
      layout: DIRECTIONS[index].layout,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Ad layouts (1080 x 1350, 4:5)                                      */
/* ------------------------------------------------------------------ */

const MARGIN = 90;
const CONTENT_WIDTH = IMAGE_AD_WIDTH - MARGIN * 2;

interface Palette {
  bg: RGB;
  ink: RGB;
  muted: RGB;
  hairline: RGB;
  plate: RGB;
  plateInk: RGB;
}

const PALETTES: Record<ImageAdSpec['layout'], Palette> = {
  editorial: { bg: BRAND.paper, ink: BRAND.ink, muted: BRAND.mutedLight, hairline: BRAND.line, plate: [238, 234, 226], plateInk: BRAND.ink },
  bold: { bg: BRAND.ink, ink: BRAND.paper, muted: BRAND.mutedDark, hairline: BRAND.inkSoft, plate: BRAND.inkSoft, plateInk: BRAND.paper },
  warm: { bg: BRAND.warm, ink: BRAND.ink, muted: [122, 106, 92], hairline: [235, 214, 193], plate: [244, 224, 203], plateInk: BRAND.ink },
};

function objectiveEyebrow(objective: ImageAdObjective['id']): string {
  const found = IMAGE_AD_OBJECTIVES.find((o) => o.id === objective);
  return (found ? found.name : objective).toUpperCase();
}

function drawBrandRow(frame: Frame, pal: Palette, x: number, y: number): number {
  drawStar(frame, x + 24, y + 22, 44, BRAND.orange);
  drawLine(frame, 'SILKWEB', x + 60, y + 8, 3, 6, pal.ink);
  return y + 52;
}

/**
 * Product-photo area. A decodable PNG upload is composited cover-fit;
 * otherwise an honest typographic plate carries the product name —
 * never a fabricated product photograph.
 */
function drawPhotoArea(
  frame: Frame,
  pal: Palette,
  photo: DecodedPhoto | null,
  product: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (photo) {
    drawPhotoCover(frame, photo, x, y, w, h);
    return;
  }
  fillRect(frame, x, y, w, h, pal.plate);
  const initial = (fontSafe(product).trim()[0] ?? 'S').toUpperCase();
  const glyphScale = Math.max(8, Math.floor(Math.min(w, h) / 14));
  drawLine(frame, initial, x + w / 2, y + h / 2 - (7 * glyphScale) / 2 - 30, glyphScale, 0, pal.plateInk, 'center');
  const nameFit = fitScale(product.length > 0 ? product : 'Your product', w - 80, 3, 2, 2);
  const blockH = measureBlock(nameFit.lines.length, nameFit.scale, 10);
  drawLines(frame, nameFit.lines, x + w / 2, y + h - blockH - 36, nameFit.scale, 2, 10, pal.muted, 'center');
}

/** Pill CTA sized to its label; returns the row bottom. */
function drawCta(frame: Frame, label: string, x: number, y: number, maxWidth: number, centerX?: number): number {
  const fit = fitScale(label, maxWidth - 96, 4, 3, 1);
  const text = fit.lines.join(' ');
  const scale = fit.scale;
  const labelW = measureLine(text, scale, 3);
  const pillW = Math.min(maxWidth, labelW + 96);
  const pillH = 7 * scale + 56;
  const px = centerX === undefined ? Math.round(x) : Math.round(centerX - pillW / 2);
  fillRoundRect(frame, px, y, pillW, pillH, pillH / 2, BRAND.orange);
  drawLine(frame, text, px + pillW / 2, y + 28, scale, 3, BRAND.paper, 'center');
  return y + pillH;
}

interface RenderContext {
  spec: ImageAdSpec;
  objective: ImageAdObjective['id'];
  product: string;
  photo: DecodedPhoto | null;
}

function renderEditorial(ctx: RenderContext): Frame {
  const pal = PALETTES.editorial;
  const frame = createFrame(IMAGE_AD_WIDTH, IMAGE_AD_HEIGHT, pal.bg);
  let y = 64;
  y = drawBrandRow(frame, pal, MARGIN, y);
  fillRect(frame, MARGIN, y + 18, CONTENT_WIDTH, 3, pal.hairline);
  y += 62;
  drawLine(frame, objectiveEyebrow(ctx.objective), MARGIN, y, 2, 8, BRAND.orange);
  y += 7 * 2 + 26;
  const head = fitScale(ctx.spec.headline, CONTENT_WIDTH, 11, 4, 3);
  y = drawLines(frame, head.lines, MARGIN, y, head.scale, 4, 18, pal.ink) + 44;
  const photoH = 520;
  drawPhotoArea(frame, pal, ctx.photo, ctx.product, MARGIN, y, CONTENT_WIDTH, photoH);
  y += photoH + 56;
  y = drawCta(frame, ctx.spec.cta, MARGIN, y, CONTENT_WIDTH) + 48;
  drawLine(frame, 'Made with SilkWeb', IMAGE_AD_WIDTH / 2, IMAGE_AD_HEIGHT - 96, 2, 4, pal.muted, 'center');
  return frame;
}

function renderBold(ctx: RenderContext): Frame {
  const pal = PALETTES.bold;
  const frame = createFrame(IMAGE_AD_WIDTH, IMAGE_AD_HEIGHT, pal.bg);
  let y = 64;
  y = drawBrandRow(frame, pal, MARGIN, y);
  y += 40;
  const photoH = 560;
  fillRect(frame, MARGIN - 6, y - 6, CONTENT_WIDTH + 12, photoH + 12, BRAND.orange);
  drawPhotoArea(frame, pal, ctx.photo, ctx.product, MARGIN, y, CONTENT_WIDTH, photoH);
  y += photoH + 60;
  drawLine(frame, objectiveEyebrow(ctx.objective), MARGIN, y, 2, 8, BRAND.orange);
  y += 7 * 2 + 26;
  const head = fitScale(ctx.spec.headline, CONTENT_WIDTH, 11, 4, 3);
  y = drawLines(frame, head.lines, MARGIN, y, head.scale, 4, 18, pal.ink) + 48;
  y = drawCta(frame, ctx.spec.cta, MARGIN, y, CONTENT_WIDTH) + 44;
  drawLine(frame, 'Made with SilkWeb', IMAGE_AD_WIDTH / 2, IMAGE_AD_HEIGHT - 96, 2, 4, pal.muted, 'center');
  return frame;
}

function renderWarm(ctx: RenderContext): Frame {
  const pal = PALETTES.warm;
  const frame = createFrame(IMAGE_AD_WIDTH, IMAGE_AD_HEIGHT, pal.bg);
  let y = 84;
  drawStar(frame, IMAGE_AD_WIDTH / 2, y + 22, 48, BRAND.orange);
  y += 76;
  drawLine(frame, 'SILKWEB', IMAGE_AD_WIDTH / 2, y, 2, 10, pal.ink, 'center');
  y += 7 * 2 + 30;
  drawLine(frame, objectiveEyebrow(ctx.objective), IMAGE_AD_WIDTH / 2, y, 2, 8, BRAND.orange, 'center');
  y += 7 * 2 + 30;
  const head = fitScale(ctx.spec.headline, CONTENT_WIDTH - 60, 10, 4, 3);
  y = drawLines(frame, head.lines, IMAGE_AD_WIDTH / 2, y, head.scale, 4, 18, pal.ink, 'center') + 48;
  const photoW = CONTENT_WIDTH - 80;
  const photoH = 500;
  const photoX = (IMAGE_AD_WIDTH - photoW) / 2;
  drawPhotoArea(frame, pal, ctx.photo, ctx.product, photoX, y, photoW, photoH);
  y += photoH + 56;
  y = drawCta(frame, ctx.spec.cta, MARGIN, y, CONTENT_WIDTH, IMAGE_AD_WIDTH / 2) + 44;
  drawLine(frame, 'Made with SilkWeb', IMAGE_AD_WIDTH / 2, IMAGE_AD_HEIGHT - 92, 2, 4, pal.muted, 'center');
  return frame;
}

/** Render one spec to a PNG Buffer. Throws only on programmer error. */
export function renderImageAd(
  spec: ImageAdSpec,
  objective: ImageAdObjective['id'],
  product: string,
  photo: DecodedPhoto | null,
): Buffer {
  const ctx: RenderContext = { spec, objective, product, photo };
  const frame =
    spec.layout === 'bold' ? renderBold(ctx) : spec.layout === 'warm' ? renderWarm(ctx) : renderEditorial(ctx);
  return encodePng(frame);
}

/**
 * Full Milestone 1 outcome: validate, build three specs, render three
 * real PNG files. PNG uploads are composited; JPEG/WebP uploads are
 * accepted and preserved client-side but noted as not composited in
 * this milestone. Never throws — failures map to payloads.
 */
export function imageAdsGenerateOutcome(parsedBody: unknown): { status: number; payload: unknown } {
  const checked = validateImageAdInput(parsedBody);
  if (!checked.ok) {
    return { status: 422, payload: { ok: false, issues: checked.issues } };
  }
  const { input } = checked;
  let photo: DecodedPhoto | null = null;
  if (input.upload && input.upload.format === 'png') {
    const decoded = decodePng(input.upload.bytes);
    if (!decoded) {
      return {
        status: 422,
        payload: { ok: false, issues: [{ field: 'productImage', message: 'Product PNG could not be decoded.' }] },
      };
    }
    photo = decoded;
  }
  const product = input.productName.length > 0 ? input.productName : 'Something new';
  const specs = buildImageAdSpecs(input);
  const ads: ImageAdResult[] = specs.map((spec) => ({
    ...spec,
    width: IMAGE_AD_WIDTH,
    height: IMAGE_AD_HEIGHT,
    pngDataUrl: `data:image/png;base64,${renderImageAd(spec, input.objective, product, photo).toString('base64')}`,
    photoComposited: photo !== null,
  }));
  return {
    status: 200,
    payload: {
      ok: true,
      objective: input.objective,
      productLabel: product,
      ads,
      photoComposited: photo !== null,
      engine: { kind: 'local-draft', modelConnected: false },
      note: 'Draft render from the local deterministic engine. Connect Muse creative review for final copy.',
    },
  };
}
