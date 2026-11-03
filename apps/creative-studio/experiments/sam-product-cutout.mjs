/**
 * SilkWeb Creative SAM 3.1 product-cutout experiment.
 * One paid SAM call; never touches the deployed Creative service.
 *
 * Run from apps/creative-studio after installing experiment-only dependencies:
 * npm.cmd install --no-save --package-lock=false openai @meta-sam/parser
 * node experiments/sam-product-cutout.mjs "C:\\path\\to\\OIP.webp"
 */
import OpenAI from 'openai';
import sharp from 'sharp';
import { parseImageStream, recordsOfKind, decodeMaskToRaster } from '@meta-sam/parser';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';

const sourcePath = process.argv[2];
const concept = (process.argv[3] ?? 'power bank').trim();
if (!sourcePath) throw new Error('Pass the product image path as the first argument.');
if (!process.env.MODEL_API_KEY) throw new Error('MODEL_API_KEY missing. No paid request made.');
if (!concept || concept.length > 80) throw new Error('Concept must be a short noun phrase.');

const bytes = await readFile(sourcePath);
const metadata = await sharp(bytes).metadata();
if (!metadata.width || !metadata.height) throw new Error('Cannot inspect source image.');
if (metadata.width * metadata.height > 8_000_000) throw new Error('Source exceeds 8MP experiment limit.');
const sourcePng = await sharp(bytes).png().toBuffer();
const root = resolve('../../experiments/creative-sam-reference-v1');
await mkdir(root, { recursive: true });
const outputPrefix = basename(sourcePath, extname(sourcePath)).replace(/[^a-zA-Z0-9_-]/g, '_');
const originalName = outputPrefix + '-source.png';
await writeFile(resolve(root, originalName), sourcePng);
console.log('SAM 3.1: one paid segmentation request, no retries');
console.log('Concept:', concept);
console.log('Source dimensions:', metadata.width, metadata.height);
const client = new OpenAI({
  apiKey: process.env.MODEL_API_KEY,
  baseURL: 'https://api.meta.ai/v1',
  timeout: 120000,
  maxRetries: 0,
});
const t0 = Date.now();
const events = await client.responses.create({
  model: 'sam-3.1',
  input: [{
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: concept },
      { type: 'input_image', image_url: 'data:image/png;base64,' + sourcePng.toString('base64') },
    ],
  }],
  stream: true,
  metadata: { mask_encoding: 'one_bit' },
});
const result = await parseImageStream(events).finalResult;
const elapsedMs = Date.now() - t0;
const masks = recordsOfKind(result.records, 'mask');
const boxes = recordsOfKind(result.records, 'box');
console.log('SAM outcome:', result.outcome.status);
console.log('Masks:', masks.length, 'Boxes:', boxes.length, 'Elapsed ms:', elapsedMs);
if (result.outcome.status !== 'completed' || masks.length === 0) {
  await writeFile(resolve(root, 'sam-report.json'), JSON.stringify({
    experiment: 'SAM-CUTOUT-001', outcome: result.outcome,
    maskCount: masks.length, boxCount: boxes.length, elapsedMs,
    diagnostics: result.diagnostics.map(d => ({ code: d.code, severity: d.severity })),
  }, null, 2));
  throw new Error('SAM produced no completed product mask. See report.');
}
// SAM masks are cropped to the detected object box, not source-image sized.
const record = masks[0];
const raster = decodeMaskToRaster(record.mask);
const w = metadata.width;
const h = metadata.height;
const box = record.bounds ?? boxes[0];
if (!box) throw new Error('SAM provided a mask without its source-image bounding box.');
const left = Math.round(box.left);
const top = Math.round(box.top);
const right = Math.round(box.right);
const bottom = Math.round(box.bottom);
if (![left,top,right,bottom].every(Number.isFinite) ||
    left < 0 || top < 0 || right >= w || bottom >= h ||
    right < left || bottom < top) {
  throw new Error('SAM bounding box is outside the source image: ' + JSON.stringify(box));
}
const cropW = record.mask.width;
const cropH = record.mask.height;
if (raster.length !== cropW * cropH)
  throw new Error('Decoded mask length disagrees with mask metadata.');
const boxW = right-left+1;
const boxH = bottom-top+1;
console.log('Mask crop:', cropW, cropH, 'Object box:', left,top,right,bottom);
// Resample only the cropped mask into SAM's source-pixel box, not the full frame.
const alphaCrop = await sharp(Buffer.from(raster),{
  raw:{width:cropW,height:cropH,channels:1}
}).resize(boxW,boxH,{kernel:'nearest'}).raw().toBuffer();
const fullAlpha = Buffer.alloc(w*h,0);
for(let y=0;y<boxH;y++){
  for(let x=0;x<boxW;x++){
    fullAlpha[(top+y)*w+left+x] = alphaCrop[y*boxW+x] ? 255 : 0;
  }
}
const { data, info } = await sharp(sourcePng).ensureAlpha().raw().toBuffer({resolveWithObject:true});
if (info.channels !== 4 || info.width !== w || info.height !== h)
  throw new Error('Unexpected source pixel format.');
let selectedPixels = 0;
for (let i = 0; i < fullAlpha.length; i++) {
  const alpha = fullAlpha[i];
  data[i*4+3] = Math.round(data[i*4+3] * (alpha/255));
  if (alpha) selectedPixels++;
}
if (selectedPixels < w*h*0.01 || selectedPixels > w*h*0.95)
  throw new Error('Product mask coverage outside expected range; review before using it.');
await writeFile(resolve(root, 'sam-product-cutout.png'),
  await sharp(data,{raw:{width:w,height:h,channels:4}}).png().toBuffer());
await writeFile(resolve(root, 'sam-report.json'), JSON.stringify({
  experiment:'SAM-CUTOUT-001', model:'sam-3.1', source:originalName, concept,
  sourceWidth:w, sourceHeight:h, elapsedMs,
  masks:masks.length, boxes:boxes.length, maskCrop:{width:cropW,height:cropH}, box:{left,top,right,bottom}, maskCoverage:Number((selectedPixels/raster.length).toFixed(4)),
  output:'sam-product-cutout.png',
  diagnostics:result.diagnostics.map(d=>({code:d.code,severity:d.severity})),
},null,2));
console.log('PASS: saved', resolve(root, 'sam-product-cutout.png'));
console.log('Mask coverage:', (selectedPixels / raster.length * 100).toFixed(1) + '%');
