import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-proved-library-operations, #sec-intrinsic-array-contracts: a proof
// accounts for the effects that could invalidate a dependency. An annotation
// or a construction that cannot run user code is not one, so it leaves a proved
// operation elsewhere in the source judged.

const P = 'class P { x: uint8 = 0; } let p: P = new P(); ';

test('an unrelated typed construction leaves a proved operation judged', () => {
  expectStaticTypeError(`${P}const m = new Map.<string, uint8>(); m.size = 3;`);
  expectStaticTypeError(`${P}const a: [2].<uint8> = [1, 2]; a.push(3);`);
  expectStaticTypeError(`${P}const n: uint8 = 1; Promise.all(n);`);
});

test('an annotation over a fresh collection or a plain literal leaves it judged', () => {
  expectStaticTypeError('const m: Map.<string, uint8> = new Map(); m.size = 3;');
  expectStaticTypeError('let o: { a: uint8 } = { a: 1 }; Object.assign({ (x: uint8): 0 }, { x: "s" });');
});

test('a construction that can run user code still withdraws the proof', () => {
  const replace = 'Object.defineProperty(Map.prototype, "size", { set(v) {}, configurable: true })';
  expect(evaluated(`class E { constructor() { ${replace}; } } let e: E = new E(); const m = new Map.<string, uint8>(); m.size = 3; 'ran';`)).toBe('ran');
  expect(evaluated(`class E { x = ${replace}; } let e: E = new E(); const m = new Map.<string, uint8>(); m.size = 3; 'ran';`)).toBe('ran');
  expect(ok('function g() {} new g(); const n: uint8 = 1; Promise.all(n);')).toBe(true);
});

test('a class annotation over a value that is not a construction of it withdraws the proof', () => {
  expectThrownKind('class P { x: uint8 = 0; } function mk(): any { return new P(); } let p: P = mk(); const m = new Map.<string, uint8>(); m.size = 3;', 'TypeError');
});
