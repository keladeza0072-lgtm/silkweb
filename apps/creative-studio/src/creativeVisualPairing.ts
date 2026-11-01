/**
 * Match the nine supplied VISUAL STUDIES to ad audiences, without treating
 * their photographs as licensed production assets.
 *
 * A visual study informs the art director. A separate cleared/original
 * scene plate can be attached later under assets/creative-approved/<id>.png.
 */
import type { ImageAdInput } from './imageAds.js';
import { inferProductCategory } from './creativeDirector.js';
import { NINE_VISUAL_STUDIES, type ReferenceStudy } from './creativeVisualStudies.js';
type Audience='cold'|'warm'|'hot';
export interface VisualPairing {
  audience:Audience;
  referenceId:string;
  title:string;
  composition:string;
  typography:string;
  productRelationship:string;
  approvedImageId:string;
  hasClearedImage:false;
}
const preferences:Record<Audience,readonly string[]>={
 cold:['TECH-HAND-01','PREMIUM-PORTRAIT-05','BOLD-GRAPHIC-06','LIFESTYLE-DESK-02','STUDIO-PLINTH-03','TACTILE-SILK-04','EDITORIAL-SPREAD-07'],
 warm:['LIFESTYLE-DESK-02','EDITORIAL-SPREAD-07','TACTILE-SILK-04','STUDIO-PLINTH-03','BOLD-GRAPHIC-06'],
 hot:['BENEFIT-STACK-08','COMPARE-SPLIT-09','STUDIO-PLINTH-03','TACTILE-SILK-04','LIFESTYLE-DESK-02'],
};
/**
 * Bare product name alone is NOT proof of claimed benefits/comparative data.
 * We gate both evidence formats for now; claims verification may lift this.
 */
export function selectVisualStudyPairs(input:ImageAdInput):[VisualPairing,VisualPairing,VisualPairing]{
 const category=inferProductCategory(input.productName);
 const used=new Set<string>();
 const audiences=['cold','warm','hot'] as const;
 return audiences.map(audience=>{
   const items=NINE_VISUAL_STUDIES.filter(study=>study.compatible.includes(category) &&
     !used.has(study.id) &&
     study.id!=='BENEFIT-STACK-08' && study.id!=='COMPARE-SPLIT-09');
   if(items.length===0)throw Error('No compatible visual studies for '+category);
   const ranked=items.map(study=>({study,index:preferences[audience].indexOf(study.id)}))
     .sort((a,b)=>(a.index<0?100:a.index)-(b.index<0?100:b.index));
   const study=ranked[0].study;
   used.add(study.id);
   return {audience,referenceId:study.id,title:study.label,
     composition:study.composition,typography:study.typography,
     productRelationship:study.productRelationship,
     approvedImageId:study.id,hasClearedImage:false as const};
 }) as [VisualPairing,VisualPairing,VisualPairing];
}
export function visualStudyPlanningGuidance(input:ImageAdInput):string{
 const chosen=selectVisualStudyPairs(input);
 return [
  '## Selected visual reference STUDIES (visual inspiration only, not copyright-cleared source photos)',
  'Make a NEW original composition. Use the design relationships, never copy the original brand photograph.',
  ...chosen.map((c,i)=>[
   'Ad '+(i+1)+' ('+c.audience+') / '+c.referenceId+' / '+c.title,
   'Composition: '+c.composition,
   'Object relationship: '+c.productRelationship,
   'Typography direction: '+c.typography,
  ].join('\n')),
 ].join('\n\n');
}
