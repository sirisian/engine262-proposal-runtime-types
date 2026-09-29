import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "const y:{a:uint8}={...null};",
  "const n:uint8=1;const y:{a:uint8}={...n};",
  "const y:{a:uint8}={...\"x\"};",
  "const y:{a:uint8}={};",
  "const x:{[k:string]:uint8}={...\"a\"};"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "const y:{a:uint8}={a:1,...null};",
  "function unused(x:any){const y:{a:uint8}={...x};}",
  "const y:{a?:uint8}={...null};",
  "const y:{a:uint8}={...null,a:1};",
  "const x:{0:string,1:string}={...\"ab\"};",
  "const x:{0:string,1:string}={...\"\ud83d\ude00\"};",
  "const x:{a:uint8}={...undefined,a:1};",
  "function f(s:string){const x:{a?:uint8}={...s};}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
