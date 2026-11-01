import type { ImageAdInput } from './imageAds.js';
import type { PlannedImageAd } from './imageAdsPlan.js';
import { CREATIVE_REFERENCES, CREATIVE_REFERENCE_REGISTRY_VERSION, type CreativeFamily, type ProductCategory } from './creativeDirectorRegistry.js';

/** Category compatibility is a safeguard against inappropriate references, not a layout template. */
export function inferProductCategory(s: string): ProductCategory {
  const name=s.toLowerCase();
  if (/power.?bank|charger|phone|headphone|earbud|laptop|tablet|usb|camera|watch|speaker|electronics/.test(name))return 'tech';
  if (/skincare|serum|cream|perfume|fragrance|cosmetic|lipstick|makeup|lotion|sunscreen|soap/.test(name))return 'beauty';
  if (/shirt|dress|pants|shoe|sneaker|handbag|jacket|clothing|fashion|hoodie|jeans/.test(name))return 'fashion';
  if (/coffee|tea|drink|juice|soda|snack|bread|chocolate|food|cookie/.test(name))return 'food';
  if (/lamp|chair|table|sofa|furniture|vase|pillow|decor|candle/.test(name))return 'home';
  return 'general';
}
export interface CreativeDirectorChoice {
  audience: 'cold'|'warm'|'hot';
  referenceId: string; family: CreativeFamily; reason: string;
  scene: string; interaction: string; camera: string; typography: string; risk: string;
}
export interface CreativeDirectorSelection {
  registryVersion:string;
  category:ProductCategory;
  selections:[CreativeDirectorChoice,CreativeDirectorChoice,CreativeDirectorChoice];
}
export function selectCreativeDirectorReferences(input: ImageAdInput): CreativeDirectorSelection {
  const category=inferProductCategory(input.productName+' '+input.differentiator);
  const audiences=['cold','warm','hot'] as const;
  const usedFamilies=new Set<CreativeFamily>(),usedIds=new Set<string>();
  const selections=audiences.map((audience)=>{
    const compatible=CREATIVE_REFERENCES.filter(r=>r.compatible.includes(category)&&r.objectives.includes(input.objective));
    const pool=compatible.length>=3?compatible:[...compatible,...CREATIVE_REFERENCES.filter(r=>r.compatible.includes('general')&&r.objectives.includes(input.objective))];
    const ranked=pool.map((r,i)=>({
      r,score:
        (usedFamilies.has(r.family)?-100:0)+(usedIds.has(r.id)?-1000:0)+
        (audience==='cold'&&r.family==='human-interaction'?35:0)+
        (audience==='warm'&&r.family==='situated-lifestyle'?35:0)+
        (audience==='hot'&&r.family==='studio-still-life'?30:0)+
        (audience==='hot'&&r.family==='tactile-editorial'?28:0)+
        (r.compatible.includes(category) && category!=='general'?20:0)-i
    })).sort((a,b)=>b.score-a.score);
    const r=ranked[0]?.r;
    if(!r)throw Error('No compatible creative reference');
    usedFamilies.add(r.family);usedIds.add(r.id);
    return {audience,referenceId:r.id,family:r.family,reason:r.rationale,scene:r.scene,
      interaction:r.interaction,camera:r.camera,typography:r.typography,risk:r.risk};
  }) as [CreativeDirectorChoice,CreativeDirectorChoice,CreativeDirectorChoice];
  return {registryVersion:CREATIVE_REFERENCE_REGISTRY_VERSION,category,selections};
}
export function buildDirectorImagePrompt(plan:PlannedImageAd,input:ImageAdInput,choice:CreativeDirectorChoice):string {
  const product=input.productName||'the pictured customer product';
  return [
    'Generate an original photorealistic commercial advertisement scene, 4:5 portrait.',
    'Customer product: '+product+'.',
    input.differentiator?'User-supplied description (unverified): '+input.differentiator+'.':'No additional product specifications were supplied.',
    'Real-world creative direction: '+choice.family+'. Reason: '+choice.reason+'.',
    'Setting: '+choice.scene+'.',
    'Product interaction: '+choice.interaction+'.',
    'Camera and lens composition: '+choice.camera+'.',
    'Creative story: '+plan.visualPrompt+'.',
    'Typography art direction for downstream finisher ONLY: '+choice.typography+'.',
    'Plan the scene with naturally legible copy space for the headline and body, without blank geometric text panels.',
    'Make the interaction physically plausible: gravity, contact shadow, scale, anatomy, perspective.',
    'Specific failure modes to prevent: '+choice.risk+'.',
    'Preserve product markings and geometry from the uploaded customer reference. Never invent specifications, ports, logos, prices, discounts or outcomes.',
    'NO rendered headline, paragraph, CTA, fake button, other product, watermarks, magical glow or surreal elements.',
    'Create original photography; do not reproduce any third-party advertisement.',
  ].join('\n').slice(0,5500);
}
