import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown, ok } from '../harness.mts';

// #sec-static-type-of-an-expression and #sec-reference-parameters-and-arguments:
// construction uses the same parameter records and binding judgments as a call.
test.each([
  'new C("s");',
  'function unused() { new C("s"); }',
  'class D extends C {} function unused() { new D("s"); }',
  'function unused() { const c: C = new.("s"); }',
])('constructor rests check known arguments before evaluation: %s', (body) => {
  expectStaticTypeError(`class C { constructor(...xs: [].<uint8>) {} } ${body}`);
});

test('constructor rest tuples retain position types and required length', () => {
  const decl = 'class C { constructor(...xs: [uint8, string]) {} }';
  expectStaticTypeError(`${decl} function unused() { new C(1); }`);
  expectStaticTypeError(`${decl} function unused() { new C("s", "s"); }`);
  expect(ok(`${decl} new C(1, "s");`)).toBe(true);
});

test('a typed fixed prefix and an empty or populated dynamic rest remain valid', () => {
  const decl = 'class C { constructor(x: string, ...xs: [].<uint8>) {} }';
  expect(ok(`${decl} new C("ok"); new C("ok", 1, 2);`)).toBe(true);
  expectStaticTypeError(`${decl} function unused() { new C("ok", "s"); }`);
});

test('constructor ref parameters require a marker and an invariant referent type', () => {
  const decl = 'class C { constructor(ref x: uint8) { x = 2; } }';
  expectStaticTypeError(`${decl} let n: uint8 = 1; function unused() { new C(n); }`);
  expectStaticTypeError(`${decl} let n: string = "s"; function unused() { new C(ref n); }`);
  expect(evaluated(`${decl} let n: uint8 = 1; new C(ref n); String(n);`)).toBe('2');
});

test('a constructor reached through any retains runtime enforcement', () => {
  expectThrown('class C { constructor(...xs: [].<uint8>) {} } const Ctor: any = C; new Ctor("s");', 'string');
});
