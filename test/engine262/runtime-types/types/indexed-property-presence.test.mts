import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "function unused(o:{[k:string]:uint8}){let p:{x:uint8}=o;}",
  "interface I{[k:string]:uint8;}interface P{x:uint8;}function unused(i:I){let p:P=i;}",
  "function f(o:{[k:string]:uint8}){let p:{x:uint8}=o;let n:uint8=p.x;globalThis.__observation=typeof n;}f({});"
])('rejects a disproved contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "function unused(o:{[k:string]:uint8}){let p:{x?:uint8}=o;}",
  "function unused(o:{x:uint8;[k:string]:uint8}){let p:{x:uint8}=o;}",
  "function unused(o:any){let p:{x:uint8}=o;}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
