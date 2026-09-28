import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "interface S{[Symbol.iterator]():{next():{done?:true;value:string}}}function unused(s:S){for(const x of s){let n:uint8=x;}}",
  "interface S{[Symbol.iterator]():{next():{done?:true;value:string}}}function unused(s:S){const a:[].<uint8>=[...s];}",
  "interface S{[Symbol.iterator]():{next():{done?:true;value:string}}}function unused(s:S){const [n:uint8]=s;}",
  "interface S{[Symbol.iterator]():{next():{done?:true;value:string}}}function call(s:S){for(const x of s){let n:uint8=x;break;}}call({[Symbol.iterator](){return {next(){return {value:\"s\"};}}}});"
])('rejects a disproved contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "interface S{[Symbol.iterator]():{next():{done?:true;value:string}}}function unused(s:S){for(const x of s){let n:string=x;}}",
  "interface S{[Symbol.iterator]():{next():{done:true;value:string}}}function unused(s:S){const a:[].<uint8>=[...s];}",
  "function unused(s:any){for(const x of s){let n:uint8=x;}}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
