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
