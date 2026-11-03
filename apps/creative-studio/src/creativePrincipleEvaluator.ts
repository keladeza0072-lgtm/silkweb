/**
 * Creative Intelligence v2: machine-readable execution criteria and
 * conservative observable checks for book-inspired advertising principles.
 *
 * These are original editorial paraphrases, NOT source-verified excerpts.
 * Automated results are observations / review prompts, NOT proof of persuasion.
 * No network/model calls, no paid inference, no exposure in customer UI.
 */
import {getPrinciple} from './knowledgePack.js';
import {selectImageAdStrategies} from './imageAdStrategy.js';
import {checkCopyQuality,copyContentTokens} from './creativeCopyIntelligence.js';
import type {ImageAdInput} from './imageAds.js';
import type {PlannedImageAd,ImageAdAudience} from './imageAdsPlan.js';

export type CriterionStatus='observed'|'flagged'|'needs-human-review';
export interface PrincipleCriterion{
 id:string;
 intent:string;
 strongExample:string;
 weakExample:string;
 observableCheck:string;
 humanReviewQuestion:string;
}
export interface PrincipleAssessment{
 audience:ImageAdAudience;
 principleId:string;
 work:string;
 verificationStatus:string;
 status:CriterionStatus;
 observation:string;
 humanReviewQuestion:string;
}
export interface CreativeIntelligenceAssessment{
 version:'creative-intelligence-v2';
 eligibleForImages:boolean;
 copyGateIssues:{field:string;message:string}[];
 assessments:PrincipleAssessment[];
 /** Explicitly not a conversion-rate, creativity score or model-grade claim. */
 note:string;
}

// Examples are illustrations of writing mechanics, NOT product facts or claims.
export const CREATIVE_EXECUTION_CRITERIA:Readonly<Record<string,PrincipleCriterion>>={
 'schwartz-awareness-match':{
  id:'schwartz-awareness-match',
  intent:'Give unfamiliar readers a recognizable reason to care; invite informed readers toward an honest next step.',
  strongExample:'Phone Dying Before You Get Home',
  weakExample:'Discover our exciting new launch',
  observableCheck:'Headline and body are product-relevant; distinct audience strategy exists.',
  humanReviewQuestion:'Does this headline meet the audience where it is without presuming knowledge or purchase intent?',
 },
 'schwartz-desire-channel':{
  id:'schwartz-desire-channel',
  intent:'Connect a plausible existing desire to the product rather than inventing a new need.',
  strongExample:'The Cafe Has No Free Outlets',
  weakExample:'A revolutionary product you need',
  observableCheck:'Look for a credible human situation; literal emotional resonance cannot be proven by a regex.',
  humanReviewQuestion:'Is the desire believable, relevant and supported by the brief rather than manufactured?',
 },
 'ogilvy-headline-plain':{
  id:'ogilvy-headline-plain',
  intent:'Make the hook clear at first reading and retain relevant product meaning.',
  strongExample:'Phone Dying Before You Get Home',
  weakExample:'An entirely new paradigm arrives',
  observableCheck:'Detect generic announcements and product relevance; clarity still needs human judgment.',
  humanReviewQuestion:'Would a first-time viewer immediately understand why this matters?',
 },
 'ogilvy-facts-first':{
  id:'ogilvy-facts-first',
  intent:'Ground factual product claims in supplied evidence; avoid stronger promises than the brief allows.',
  strongExample:'Compact backup power for the trip home',
  weakExample:'The fastest charger in the world',
  observableCheck:'Pattern-based unsupported-claim and policy gates; no external fact verification.',
  humanReviewQuestion:'Can every concrete promise be traced to the supplied product facts?',
 },
 'sugarman-slide-flow':{
  id:'sugarman-slide-flow',
  intent:'Make headline, body and CTA form one persuasive chain.',
  strongExample:'Low battery on the train? / Keep backup power nearby. / See Details',
  weakExample:'Big news / This product exists / Learn More',
  observableCheck:'Presence of complete headline/body/CTA and short CTA; logical continuity needs human review.',
  humanReviewQuestion:'Does every line naturally motivate reading the next one, ending with a meaningful action?',
 },
 'sugarman-curiosity-honest':{
  id:'sugarman-curiosity-honest',
  intent:'Invite honest curiosity and resolve it in the same message.',
  strongExample:'The Cafe Has No Free Outlets / Keep your compact power bank close',
  weakExample:'The secret they do not want you to know',
  observableCheck:'Detect obvious clickbait patterns; interestingness and payoff require human review.',
  humanReviewQuestion:'Is curiosity earned and satisfied without clickbait?',
 },
 'cialdini-proof-needs-evidence':{
  id:'cialdini-proof-needs-evidence',
  intent:'Use authority, popularity, endorsements or scarcity only with supporting evidence.',
  strongExample:'See details about this compact power bank',
  weakExample:'Doctors recommend the #1 power bank',
  observableCheck:'Detect explicit unsubstantiated promotional/authority patterns; implied claims may escape.',
  humanReviewQuestion:'Is every authority or social-proof cue authentic, relevant and documented?',
 },
 'cialdini-small-step':{
  id:'cialdini-small-step',
  intent:'Give an easy honest next action without false urgency.',
  strongExample:'See product details before choosing',
  weakExample:'Act now before it sells out',
  observableCheck:'CTA length and presence; appropriateness of action requires human judgment.',
  humanReviewQuestion:'Is this a single low-friction action that the user can actually take?',
 },
};

const CLICKBAIT=/\b(secret they|won['’]?t believe|shocking truth|what they don['’]?t want you to know)\b/i;
const UNSUPPORTED_FEAR=/\b(guaranteed|only today|sell(?:s)? out|everyone loves|doctors recommend)\b/i;
const norm=(s:string)=>s.trim().replace(/\s+/g,' ');

/** Assess an already validated 3-plan set. Do not expose this internal report to customers. */
export function evaluateCreativePrinciples(
 plans:readonly PlannedImageAd[],
 input:ImageAdInput,
):CreativeIntelligenceAssessment{
 const {strategies}=selectImageAdStrategies(input);
 const gate=checkCopyQuality(plans,input);
 const assessments:PrincipleAssessment[]=[];
 for(const strategy of strategies){
  const plan=plans.find(p=>p.audience===strategy.audience);
  for(const id of strategy.principleIds){
   const source=getPrinciple(id);
   const criterion=CREATIVE_EXECUTION_CRITERIA[id];
   if(!source||source.verificationStatus==='pending-review'||!criterion)
    throw Error('Missing reviewed creative criterion for '+id);
   let status:CriterionStatus='needs-human-review';
   let observation='Requires editorial review; no deterministic rule proves persuasive success.';
   if(!plan){
    status='flagged';observation='Required audience plan is missing.';
   }else{
    const text=norm(plan.headline+' '+plan.body+' '+plan.cta);
    const issues=gate.issues.filter(i=>i.field.startsWith('plans['+plans.indexOf(plan)+']'));
    if(issues.length>0){
     status='flagged';observation='Existing copy gate reported: '+issues.map(i=>i.message).join(' | ');
    }else if(id==='sugarman-slide-flow'||id==='cialdini-small-step'){
     if(!norm(plan.headline)||!norm(plan.body)||!norm(plan.cta)){
      status='flagged';observation='Missing headline, body or CTA.';
     }else if(id==='cialdini-small-step'&&copyContentTokens(plan.cta).length>5){
      status='flagged';observation='CTA too long to be a low-friction step.';
     }else{
      status='observed';observation='Structural prerequisite observed (complete copy and bounded CTA); persuasive execution still needs review.';
     }
    }else if((id==='sugarman-curiosity-honest'&&CLICKBAIT.test(text))||
             (id==='cialdini-proof-needs-evidence'&&UNSUPPORTED_FEAR.test(text))){
     status='flagged';observation='Potential unsupported persuasive language detected; check against supplied facts.';
    }else if(id==='ogilvy-facts-first'||id==='cialdini-proof-needs-evidence'){
     status='observed';observation='No pattern-based claim issue detected; this is NOT external fact verification.';
    }
   }
   assessments.push({
    audience:strategy.audience,
    principleId:id,
    work:source.work,
    verificationStatus:source.verificationStatus,
    status,observation,humanReviewQuestion:criterion.humanReviewQuestion,
   });
  }
 }
 return {
  version:'creative-intelligence-v2',
  eligibleForImages:gate.ok&&assessments.every(a=>a.status!=='flagged'),
  copyGateIssues:gate.issues,
  assessments,
  note:'Deterministic screening plus explicit human-review prompts. Observed does not mean the model applied a book principle; no source verification or conversion evidence is implied.',
 };
}
