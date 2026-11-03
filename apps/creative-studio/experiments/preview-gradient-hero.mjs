/**
 * Render three gradient variants from a REAL transparent cutout for visual QA.
 * No model calls; will refuse opaque photographs, never imitate a successful
 * SAM segmentation. Usage:
 * node experiments/preview-gradient-hero.mjs "C:\path\sam-product-cutout.png"
 */
import sharp from 'sharp';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {renderGradientHero} from '../dist/creativeGradientHero.js';
const input=process.argv[2];
if(!input)throw Error('Usage: node experiments/preview-gradient-hero.mjs "path to transparent product PNG"');
const product=await readFile(input);
const out=resolve('../../experiments/gradient-hero-preview-v1');
await mkdir(out,{recursive:true});
const concepts=[
 {variant:'top-product-bottom',headline:'Power to carry your day.',body:'Meet the INIU compact power bank. Designed for everyday carry.'},
 {variant:'text-left-product-right',headline:'Take power along.',body:'Your compact INIU power bank, ready to travel with you.'},
 {variant:'product-left-text-right',headline:'Small thing. Big day.',body:'Discover the INIU compact power bank.'},
];
const report=[];
for(const [i,concept] of concepts.entries()){
 const result=await renderGradientHero(product,{...concept,cta:'Explore'},concept.variant);
 if(!result.ok){console.error('STOP',concept.variant,result.reason);process.exitCode=1;continue;}
 const file=String(i+1).padStart(2,'0')+'-'+concept.variant+'.png';
 await writeFile(join(out,file),result.png);
 report.push({file,headline:concept.headline,...result.diagnostics});
 console.log('CREATED:',file,'1080x1350',result.diagnostics.headlineLines.join(' | '));
}
await writeFile(join(out,'report.json'),JSON.stringify({kind:'offline-composite-only',modelCalls:0,variants:report},null,2));
console.log('Preview folder:',out);
console.log('No paid inference and no model-generated product cutout created by this script.');
