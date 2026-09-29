import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){for(const x of s){let y:uint8=x;}}",
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){for(const x of s){let y:uint8=x;globalThis.observed=typeof y;break;}}f({[Symbol.iterator](){return {next(){return {done:false};}}}});",
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){const a:[].<uint8>=[...s];}",
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){const [n:uint8]=s;}",
  "interface S{[Symbol.asyncIterator]():{next():{done:false;value?:uint8}}}async function f(s:S){for await(const x of s){let y:uint8=x;}}",
  "function* f(s:{[Symbol.iterator]():{next():{done:false;value?:uint8}}}):Generator.<uint8,void,void>{yield* s;}",
  "async function* f(s:{[Symbol.asyncIterator]():{next():{done:false;value?:uint8}}}):AsyncGenerator.<uint8,void,void>{yield* s;}"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){for(const x of s){let y:uint8|undefined=x;}}",
  "interface S{[Symbol.iterator]():{next():{done:false;value:uint8}}}function f(s:S){for(const x of s){let y:uint8=x;}}",
  "function f(s:any){for(const x of s){let y:uint8=x;}}",
  "interface S{[Symbol.iterator]():{next():{done:false;value?:uint8}}}function f(s:S){const [x:uint8=1]=s;}",
  "async function f(s:{[Symbol.asyncIterator]():{next():{done:false;value?:Promise.<uint8,any>}}}){for await(const x of s){const y:Promise.<uint8,any>|undefined=x;}}",
  "async function f(s:{[Symbol.iterator]():{next():{done:false;value?:Promise.<uint8,any>}}}){for await(const x of s){const y:uint8|undefined=x;}}",
  "function f(s:{[Symbol.iterator]():{next():{done:true;value?:string}|{done:false;value:uint8}}}){for(const x of s){const y:uint8=x;}}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
