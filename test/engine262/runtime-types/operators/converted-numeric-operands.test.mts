import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "function unused(n:uint8,b:boolean){return n-b;}",
  "function unused(n:uint8){return n-null;}",
  "function unused(n:uint8,b:undefined){return n-b;}",
  "function unused(n:uint8,b:boolean){return n<b;}",
  "function unused(n:uint8,b:boolean){return n&b;}",
  "function f(n:uint8,b:boolean){return n-b;}f(1,true);"
])('rejects a disproved contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "function f(n:number,b:boolean){return n-b;}f(1,true);",
  "function f(n:uint8,s:string){return n*s;}f(1,\"2\");",
  "function f(n:uint8,b:boolean){return number(n)-b;}f(1,true);",
  "function unused(n:uint8,b:any){return n-b;}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
