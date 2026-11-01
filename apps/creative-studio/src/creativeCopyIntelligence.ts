/**
 * SilkWeb Copy Intelligence v1.
 * Applied design heuristics inspired by Schwartz's audience-awareness
 * and existing-desire concepts and Cialdini's evidence-dependent
 * persuasion principles. These are original rules, not book excerpts.
 */
export const COPY_INTELLIGENCE_VERSION='silkweb-copy-intelligence-v1';
export const COPY_INTELLIGENCE_RULES=[
 'HEADLINE IS THE HOOK: The purpose of a headline is to earn attention through relevant desire, tension, striking specificity, useful curiosity, or a credible benefit. Do not merely announce the campaign.',
 'AUDIENCE DIFFERENTIATION: For cold traffic evoke a recognizable everyday desire or context; for warm traffic show an honest product-relevant reason to consider it; for hot traffic make the next action feel clear and worthwhile, without inventing urgency.',
 'PERSUASION: Use identity, curiosity, contrast, tangible context, and believable benefit framing when supported by facts. Cialdini-style authority, social proof, reciprocity, scarcity, and commitments require explicit supporting information; do not manufacture them.',
 'SCHWARTZ: Match the hook to likely awareness and existing desires rather than forcing a formula. Audience cold/warm/hot does not perfectly identify the five awareness stages; do not claim otherwise.',
 'THREE DIFFERENT IDEAS: Each ad must persuade for a different reason, not merely paraphrase the same product launch. Vary headline structure and emotional/functional entry point.',
 'NO EMPTY FILLER: Avoid "What is new from", "Considering a", "Hey - it\'s here", "just announced", "come see", "take a first look", "meet the new arrival", and other generic self-referential announcements.',
 'CLAIMS: Never invent capacity, charging speed, compatibility, price, endorsement, review, market position, awards, effectiveness, launch date, popularity, or limited stock.',
 'WRITE FOR A REAL DESIGN: Prefer short, high-impact headline candidates where possible; use more words when the idea needs them. Supply readable supporting copy; do not require every sentence to be rendered directly onto the photograph.',
] as const;
export function buildCopyIntelligenceSection():string{
 return '## SilkWeb Persuasive Copy Intelligence ('+COPY_INTELLIGENCE_VERSION+')\n'+
 COPY_INTELLIGENCE_RULES.map((r,i)=>(i+1)+'. '+r).join('\n');
}
export function scoreHeadlineDiagnostics(headline:string):{pass:boolean;issues:string[]}{
 const issues:string[]=[];
 const h=headline.trim();
 if(h.length<8)issues.push('Too little content to evaluate as a persuasive hook');
 if(h.length>100)issues.push('Headline is unusually long for an image advertisement');
 if(/^(what is new|considering a|hey[\s,!-]+it.s here|meet the new arrival|come see)/i.test(h))
  issues.push('Generic opening observed in low-quality baseline campaign');
 if(/\b(best|fastest|number one|#1|guaranteed|free|limited time|sold out)\b/i.test(h))
  issues.push('Evidence-dependent or promotional claim requires explicit verification');
 return {pass:issues.length===0,issues};
}

/* ------------------------------------------------------------------ */
/* Copy-quality gate v1 (deterministic, pre-inference).                */
/*                                                                     */
/* checkCopyQuality runs on validated plans AFTER Muse Spark planning  */
/* and BEFORE the first Muse Image call. Every rule below is a pure    */
/* string heuristic with no model calls, so results are stable for the */
/* same input. The gate is deliberately conservative: it blocks only   */
/* clearly weak or unsupported copy and preserves credible, creative   */
/* headlines — including short ones and ones that never name the       */
/* product. Shortness alone is never a failure.                        */
/* ------------------------------------------------------------------ */

export const COPY_QUALITY_VERSION='silkweb-copy-quality-gate-v1';

/** Maximum reasonable rendered-copy lengths for a 4:5 image ad. */
export const COPY_QUALITY_LIMITS={
 headlineChars:80,
 bodyChars:280,
 ctaChars:30,
 ctaWords:5,
} as const;

/** Minimal plan shape the gate needs (PlannedImageAd satisfies this). */
export interface CopyQualityPlan{
 angle:string;
 headline:string;
 body:string;
 cta:string;
}

/** Minimal brief shape the gate needs (ImageAdInput satisfies this). */
export interface CopyQualityBrief{
 productName:string;
 differentiator?:string;
 price?:string;
 currency?:string;
 specialOffer?:string;
}

export interface CopyQualityIssue{
 field:string;
 message:string;
}

export interface CopyQualityResult{
 ok:boolean;
 issues:CopyQualityIssue[];
}

const STOPWORDS=new Set([
 'a','an','the','and','or','but','for','with','of','to','in','on','at','by','is','are',
 'was','were','be','been','it','its','this','that','these','those','as','from','into',
 'your','you','our','we','they','them','their','his','her','my','me','us','so','if',
 'then','than','too','very','just','up','out','over','again','once','here','there',
 'when','while','how','what','which','who','all','any','each','more','most','other',
 'some','such','no','not','only','own','same','will','can','should','now',
]);

function rawTokens(text:string):string[]{
 return text.toLowerCase().replace(/[^a-z0-9$€£¥₹%\s]/g,' ').split(/\s+/).filter((t)=>t.length>0);
}

/** Lowercase content tokens with stopwords removed. */
export function copyContentTokens(text:string):string[]{
 return rawTokens(text).filter((t)=>!STOPWORDS.has(t));
}

/** Crude singular stem so "candle" matches "candles" and "bean" matches "beans". */
export function stemCopyToken(token:string):string{
 if(token.length>4&&token.endsWith('ies'))return token.slice(0,-3)+'y';
 if(token.length>3&&token.endsWith('ses'))return token.slice(0,-2);
 if(token.length>3&&token.endsWith('s')&&!token.endsWith('ss'))return token.slice(0,-1);
 return token;
}

function stemSet(tokens:string[]):Set<string>{
 return new Set(tokens.map(stemCopyToken));
}

function jaccard(a:ReadonlySet<string>,b:ReadonlySet<string>):number{
 if(a.size===0&&b.size===0)return 1;
 let shared=0;
 for(const t of a)if(b.has(t))shared+=1;
 return shared/(a.size+b.size-shared);
}

/* ---------------- Generic and filler headlines -------------------- */

const GENERIC_HEADLINE_OPENINGS=[
 /^what is new from\b/i,
 /^what'?s new from\b/i,
 /^considering a\b/i,
 /^hey[\s,!-]+(it['’]?s here|here|there)\b/i,
 /^meet the new arrival\b/i,
 /^come (see|check out|take a look)\b/i,
 /^take a first look\b/i,
 /^just announced\b/i,
 /^now available\b/i,
 /^check (this|it) out\b/i,
 /^(great|big|exciting) news\b/i,
 /^we'?re (excited|proud|thrilled) to (announce|present|share)\b/i,
 /^you won'?t believe\b/i,
];

/** Whole headlines that are only a bare call-to-action or vague filler. */
const GENERIC_HEADLINE_WHOLE=[
 /^(buy now|shop now|order now|click here|learn more|get yours|sign up|submit)[.!]*$/i,
 /^something special for you[.!]*$/i,
 /^quality you (can|will) trust[.!]*$/i,
 /^(the )?(perfect|ideal) choice for everyone[.!]*$/i,
 /^don'?t miss out[.!]*$/i,
 /^great (quality|product|products) for everyone[.!]*$/i,
];

/**
 * True when a headline is generic filler: a known announcement opening,
 * a bare CTA standing in for a hook, or an all-vague noun phrase with no
 * concrete content. Product mentions never exempt a filler opening.
 */
export function isGenericHeadline(headline:string):boolean{
 const h=headline.trim();
 if(GENERIC_HEADLINE_OPENINGS.some((re)=>re.test(h)))return true;
 if(GENERIC_HEADLINE_WHOLE.some((re)=>re.test(h)))return true;
 return false;
}

/* ---------------- Repeated headline structures -------------------- */

function headlineMood(headline:string):string{
 const h=headline.trim();
 if(h.endsWith('?'))return 'question';
 if(h.endsWith('!'))return 'exclaim';
 return 'statement';
}

function lengthBucket(words:number):string{
 if(words<=4)return 'short';
 if(words<=8)return 'medium';
 return 'long';
}

/**
 * Structural fingerprint of one headline: first word, sentence mood,
 * and length bucket. Ads in one campaign may share a mood, but all
 * three sharing one fingerprint means one idea said three times.
 */
export function headlineStructureKey(headline:string):string{
 const words=rawTokens(headline);
 const first=words[0]??'';
 return first+'|'+headlineMood(headline)+'|'+lengthBucket(words.length);
}

function openingBigram(headline:string):string{
 const words=rawTokens(headline);
 if(words.length<2)return '';
 return words[0]+' '+words[1];
}

/* ---------------- Product relevance without name repetition -------- */

interface CategoryLexicon{
 match:RegExp;
 cues:string[];
}

const CATEGORY_LEXICONS:CategoryLexicon[]=[
 {match:/power|bank|charg|battery|\bmah\b|voltpack/i,cues:['power','charge','charging','battery','backup','portable','plug','cable','phone','energy','mah','volt','watt']},
 {match:/skin|serum|cream|moistur|glow|face|derma|lotion|skincare/i,cues:['skin','serum','cream','glow','face','moisture','hydrate','hydration','radiance','routine','gentle']},
 {match:/coffee|brew|espresso|roast|bean|latte|caf[eé]/i,cues:['coffee','brew','brewing','espresso','roast','roasted','bean','beans','caffeine','morning','cup','bold']},
 {match:/dress|fashion|cotton|wear|apparel|shirt|jacket|denim|outfit|wardrobe|style|gown/i,cues:['wear','dress','cotton','fit','fabric','style','outfit','wardrobe','comfort','soft','summer']},
 {match:/lamp|d[eé]cor|candle|ceramic|vase|lantern|interior|furniture|cushion/i,cues:['room','home','light','glow','lamp','candle','candles','ceramic','table','interior','space','decor','cozy','evening','calm']},
];

function categoryCuesForBrief(brief:CopyQualityBrief):string[]|null{
 const facts=((brief.productName??'')+' '+(brief.differentiator??'')).toLowerCase();
 const cues=new Set<string>();
 for(const lex of CATEGORY_LEXICONS){
  if(lex.match.test(facts))for(const c of lex.cues)cues.add(c);
 }
 return cues.size>0?[...cues]:null;
}

function briefContentStems(brief:CopyQualityBrief):Set<string>{
 const nameTokens=rawTokens(brief.productName??'').filter((t)=>t.replace(/[^a-z0-9]/g,'').length>=3);
 const diffTokens=rawTokens(brief.differentiator??'').filter((t)=>t.replace(/[^a-z0-9]/g,'').length>=4);
 return stemSet([...nameTokens,...diffTokens]);
}

/**
 * True when the copy shows real product relevance: it uses a word from
 * the product name or differentiator, or a concrete category cue (for
 * example "backup power" for a power bank). Creative headlines that never
 * name the product still pass when they carry such a cue.
 */
export function hasProductRelevance(copy:string,brief:CopyQualityBrief):boolean{
 const stems=stemSet(copyContentTokens(copy));
 if(stems.size===0)return false;
 const briefStems=briefContentStems(brief);
 for(const s of briefStems)if(stems.has(s))return true;
 const cues=categoryCuesForBrief(brief);
 if(cues===null)return briefStems.size===0;
 const cueStems=stemSet(cues);
 for(const s of stems)if(cueStems.has(s))return true;
 return false;
}

/* ---------------- Unsupported specific claims --------------------- */

const SPEC_CLAIM=/\d[\d.,]*\s?(mah|mwh|wh|watts?|w\b|hours?|hrs?|minutes?|mins?|seconds?|gb|tb|mp\b|x\b|%|percent)\b/i;
const RANK_CLAIM=/#\s?1\b|number one\b|no\.?\s?1\b|\bbest\b|\bfastest\b|\bcheapest\b|world'?s (first|best)|first-?ever\b/i;
const ENDORSE_CLAIM=/dermatologist|clinically proven|clinical(ly)? test|doctor-?recommended|dentist-?approved|celebrity|as seen on|5-?star|award-?winning/i;
const EFFICACY_CLAIM=/removes? wrinkles|erases? wrinkles|burns? fat|lose \d|guaranteed|miracle|instantly (removes?|erases?|heals?)/i;

function factsText(brief:CopyQualityBrief):string{
 return [brief.differentiator??'',brief.price??'',brief.currency??'',brief.specialOffer??''].join(' ').toLowerCase();
}

function supportedByFacts(matched:string,brief:CopyQualityBrief):boolean{
 const facts=factsText(brief);
 const digits=matched.replace(/[^0-9.]/g,'').replace(/^\.+|\.+$/g,'');
 if(digits.length>0&&facts.includes(digits))return true;
 const words=matched.toLowerCase().split(/[^a-z0-9]+/).filter((w)=>w.length>=3);
 return words.length>0&&words.every((w)=>facts.includes(w));
}

/** Names of identifiable specific claims in one copy field, empty when none. */
export function findUnsupportedClaims(field:string,brief:CopyQualityBrief):string[]{
 const found:string[]=[];
 const checks:ReadonlyArray<readonly [RegExp,string]>=[
  [SPEC_CLAIM,'a specific measurable claim'],
  [RANK_CLAIM,'a ranking or superlative claim'],
  [ENDORSE_CLAIM,'an endorsement or certification claim'],
  [EFFICACY_CLAIM,'an efficacy or guarantee claim'],
 ];
 for(const [re,label] of checks){
  const m=field.match(re);
  if(m&&!supportedByFacts(m[0],brief))found.push(label+' ('+m[0].trim()+')');
 }
 return found;
}

/* ---------------- The gate ---------------------------------------- */

/**
 * Deterministic copy-quality gate over three validated plans.
 * Returns every blocking issue; empty issues means the copy may proceed
 * to paid image generation. Checks, per plan: filler headlines, product
 * relevance, unsupported claims, and unreasonable length. Checks across
 * the triple: repeated headline structures and indistinct angles.
 */
export function checkCopyQuality(plans:readonly CopyQualityPlan[],brief:CopyQualityBrief):CopyQualityResult{
 const issues:CopyQualityIssue[]=[];
 const list=[...plans];

 list.forEach((plan,index)=>{
  const headline=(plan.headline??'').trim();
  const body=(plan.body??'').trim();
  const cta=(plan.cta??'').trim();

  if(isGenericHeadline(headline)){
   issues.push({field:'plans['+index+'].headline',message:'Plan '+(index+1)+' headline is generic filler, not a persuasive hook.'});
  }
  const combined=(headline+' '+body).trim();
  if(combined.length>0&&!hasProductRelevance(combined,brief)){
   issues.push({field:'plans['+index+'].headline',message:'Plan '+(index+1)+' copy shows no concrete product relevance.'});
  }
  const fields:ReadonlyArray<readonly [string,string]>=[
   ['plans['+index+'].headline',headline],
   ['plans['+index+'].body',body],
   ['plans['+index+'].cta',cta],
  ];
  for(const [field,value] of fields){
   for(const claim of findUnsupportedClaims(value,brief)){
    issues.push({field,message:'Plan '+(index+1)+' makes '+claim+' without supporting facts.'});
   }
  }
  if(headline.length>COPY_QUALITY_LIMITS.headlineChars){
   issues.push({field:'plans['+index+'].headline',message:'Plan '+(index+1)+' headline is too long for an image advertisement ('+headline.length+' characters).'});
  }
  if(body.length>COPY_QUALITY_LIMITS.bodyChars){
   issues.push({field:'plans['+index+'].body',message:'Plan '+(index+1)+' body copy is too long for an image advertisement ('+body.length+' characters).'});
  }
  if(cta.length>COPY_QUALITY_LIMITS.ctaChars||copyContentTokens(cta).length>COPY_QUALITY_LIMITS.ctaWords){
   issues.push({field:'plans['+index+'].cta',message:'Plan '+(index+1)+' call-to-action is too long for an image advertisement.'});
  }
 });

 if(list.length===3){
  const keys=list.map((p)=>headlineStructureKey(p.headline??''));
  const firsts=rawTokens(list[0].headline??'')[0]??'';
  const sameFirst=list.every((p)=>(rawTokens(p.headline??'')[0]??'')===firsts&&firsts!=='');
  const bigrams=list.map((p)=>openingBigram(p.headline??''));
  const sameBigram=bigrams[0]!==''&&bigrams.every((b)=>b===bigrams[0]);
  if(keys.every((k)=>k===keys[0])||sameFirst||sameBigram){
   issues.push({field:'plans',message:'All three headlines share one repeated structure; each ad needs its own hook.'});
  }
  const headStems=list.map((p)=>stemSet(copyContentTokens(p.headline??'')));
  for(let i=0;i<headStems.length;i+=1){
   for(let j=i+1;j<headStems.length;j+=1){
    if(jaccard(headStems[i],headStems[j])>=0.75){
     issues.push({field:'plans',message:'Headlines '+(i+1)+' and '+(j+1)+' are near-paraphrases; each ad needs a distinct hook.'});
    }
   }
  }
  const angleStems=list.map((p)=>stemSet(copyContentTokens(p.angle??'')));
  for(let i=0;i<angleStems.length;i+=1){
   for(let j=i+1;j<angleStems.length;j+=1){
    if(angleStems[i].size>0&&jaccard(angleStems[i],angleStems[j])>=0.6){
     issues.push({field:'plans',message:'Ads '+(i+1)+' and '+(j+1)+' repeat one creative angle; each ad must persuade for a different reason.'});
    }
   }
  }
 }

 return {ok:issues.length===0,issues};
}
