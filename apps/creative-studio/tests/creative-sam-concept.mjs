import assert from 'node:assert/strict';
import {samObjectConcept} from '../dist/creativeSam31.js';
for(const [input,expected] of [
 ['INIU compact power bank','power bank'],
 ['Compact portable charger','power bank'],
 ['Wireless headphones','headphones'],
 ['Gentle face serum','bottle'],
 ['Roasted coffee beans','coffee bag'],
 ['Running sneakers','shoe'],
 ['Table lamp','lamp'],
]){
 assert.equal(samObjectConcept(input),expected,input);
}
console.log('PASS: SAM concept prompts are short object nouns; no model calls.');