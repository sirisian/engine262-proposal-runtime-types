import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "const n:uint8=1;new Set.<uint8>(n);",
  "const n:uint8=1;new Map.<string,uint8>(n);",
  "const n:uint8=1;new WeakMap.<object,uint8>(n);",
  "const n:uint8=1;new WeakSet.<object>(n);"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "new Set.<uint8>(null);",
  "new Map.<string,uint8>(null);",
  "function unused(x:any){new Set.<uint8>(x);new Map.<string,uint8>(x);}",
  "new Set.<uint8>();new Map.<string,uint8>(undefined);"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("set proto iterator", () => {
  expect(evaluatedSequence([
  "Number.prototype[Symbol.iterator]=function(){return [1][Symbol.iterator]();};",
  "const n:uint8=1;new Set.<uint8>(n);\"accepted\";"
])).toBe('accepted');
});

test("map proto iterator", () => {
  expect(evaluatedSequence([
  "Number.prototype[Symbol.iterator]=function(){return [[\"x\",1]][Symbol.iterator]();};",
  "const n:uint8=1;new Map.<string,uint8>(n);\"accepted\";"
])).toBe('accepted');
});

test("preserves the prior-script dependency: const n:uint8=1;new Set.<uint8>(n);", () => {
  expect(evaluatedSequence([
  "Object.defineProperty(Number.prototype,Symbol.iterator,{get(){return function(){return [1][Symbol.iterator]();}}});",
  "const n:uint8=1;new Set.<uint8>(n);\"accepted\";"
])).toBe('accepted');
});

test('a future function invocation cannot assume primitive iterator absence', () => {
  expect(ok('function unused(n:uint8){new Set.<uint8>(n);new Map.<string,uint8>(n);}')).toBe(true);
});
