import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "class C{constructor(x:uint8){}}Reflect.construct(C,[\"s\"]);",
  "Reflect.construct((x:uint8)=>x,[1]);",
  "class C{}const n:uint8=1;Reflect.construct(C,[],n);",
  "function C(x:uint8){}Reflect.construct(C,[\"s\"]);",
  "class C{constructor(x:uint8){}}class D{constructor(x:string){}}Reflect.construct(C,[\"s\"],D);",
  "class C{}Reflect.construct(C,[],(x:uint8)=>x);"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "class C{constructor(x:uint8){}}Reflect.construct(C,[1]);",
  "function unused(c:any,args:any){Reflect.construct(c,args);}",
  "class C{constructor(x:uint8){}}class D{}Reflect.construct(C,[1],D);",
  "class C{constructor(x:uint8){}}class D{constructor(x:string){}}Reflect.construct(C,[1],D);"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("reflect construct replaced", () => {
  expect(evaluatedSequence([
  "Reflect.construct=function(){return {};};",
  "class C{constructor(x:uint8){}}Reflect.construct(C,[\"s\"]);\"accepted\";"
])).toBe('accepted');
});

test("preserves the prior-script dependency: Reflect.construct((x)=>x,[1]);", () => {
  expect(evaluatedSequence([
  "Reflect.construct=function(){return {};};",
  "Reflect.construct((x)=>x,[1]);\"accepted\";"
])).toBe('accepted');
});
