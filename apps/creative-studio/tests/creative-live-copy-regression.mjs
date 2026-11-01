import assert from 'node:assert/strict';
import {checkCopyQuality,isGenericHeadline} from '../dist/creativeCopyIntelligence.js';
import {buildImageAdPlanPrompt} from '../dist/imageAdsPlan.js';
const weak=[
 {angle:'Introduce the compact power bank',headline:'Want a simple way to carry a charge with you?',body:'This is the new INIU compact power bank. Explore the launch to see it.',cta:'Explore the Launch'},
 {angle:'Low battery interruptions',headline:'A low battery in the middle of the day.',body:'That pause can interrupt what you had planned. The new INIU compact power bank is a compact option.',cta:'Learn More'},
 {angle:'Direct new launch',headline:"Let's take a minute with the new launch.",body:"It's the new INIU compact power bank. Have a look and see what it is.",cta:'See the Launch'},
];
const brief={productName:'INIU compact power bank',differentiator:'',specialOffer:''};
const result=checkCopyQuality(weak,brief);
assert.equal(result.ok,false,'Real weak Spark output must be rejected');
assert.ok(result.issues.some(i=>i.field==='plans[0].headline'));
assert.ok(result.issues.some(i=>i.field==='plans[1].headline'));
assert.ok(result.issues.some(i=>i.field==='plans[2].headline'));
assert.ok(result.issues.some(i=>i.message.includes('unverified launch')));
assert.equal(isGenericHeadline('Want a simple way to carry a charge with you?'),true);
assert.equal(isGenericHeadline('Your day. Your backup power.'),false);
process.env.SILKWEB_CREATIVE_DIRECTOR='on';
const prompt=buildImageAdPlanPrompt({productName:'INIU compact power bank',objective:'launch-product',upload:null,differentiator:'',price:'',currency:'',specialOffer:''});
assert.ok(prompt.length<=8000,'Planning prompt must fit budget');
assert.ok(prompt.includes('does NOT establish that the product is new'));
console.log('PASS: 3 real weak live headlines rejected, unsupported new-product claims caught, strong hook preserved, Muse prompt under 8k ('+prompt.length+').');
