import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "const x:{[Symbol.toStringTag]:string}={};",
  "interface I{[Symbol.iterator]():Iterator.<uint8>}const x:I={};",
  "const x:{[Symbol.iterator]():Iterator.<uint8>}={};"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "const x:{[Symbol.toStringTag]?:string}={};",
  "const x:{[Symbol.toStringTag]:string}={[Symbol.toStringTag]:\"ok\"};",
  "function unused(x:any){const y:{[Symbol.toStringTag]:string}=x;}",
  "Object.prototype[Symbol.toStringTag]=\"ok\";const x:{[Symbol.toStringTag]:string}={};"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("symbol member prior prototype", () => {
  expect(evaluatedSequence([
  "Object.prototype[Symbol.toStringTag]=\"ok\";",
  "const x:{[Symbol.toStringTag]:string}={};\"accepted\";"
])).toBe('accepted');
});

test("preserves the prior-script dependency: const x:{[Symbol.toStringTag]:string}={};", () => {
  expect(evaluatedSequence([
  "Object.defineProperty(Object.prototype,Symbol.toStringTag,{get(){return \"ok\";}});",
  "const x:{[Symbol.toStringTag]:string}={};\"accepted\";"
])).toBe('accepted');
});
