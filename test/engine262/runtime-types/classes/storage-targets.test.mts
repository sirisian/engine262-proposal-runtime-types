import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

test.each(['(x)', '(c.x)', '(a[0])'])('parenthesized target %s retains its storage type', (target) => {
  expectStaticTypeError(`function f() { let x: uint8 = 1; let c: {x: uint8} = {x:1}; let a: [uint8] = [1]; ${target} = "bad"; }`);
});

test.each(['(c.x) = 2', '(c.x)++', '++(c.x)'])('readonly targets reject %s', (write) => {
  expectStaticTypeError(`class C { readonly x: uint8 = 1; } function f(c: C) { ${write}; }`);
  expectStaticTypeError(`function f(c: {readonly x: uint8}) { ${write}; }`);
});

test('parenthesized private readonly fields remain readonly', () => {
  expectStaticTypeError('class C { readonly #x: uint8 = 1; m() { (this.#x) = 2; } }');
});

test.each(['(c.x)', '(c["x"])', 'c?.x'])('delete rejects a known typed target through %s', (target) => {
  expectStaticTypeError(`class C { x: uint8 = 1; } function f(c: C) { delete ${target}; }`);
});

test('deletion keeps ordinary objects and null short circuiting', () => {
  expect(evaluated('let c = {x:1}; String(delete (c.x));')).toBe('true');
  expect(evaluated('const c = null; String(delete c?.x);')).toBe('true');
  expect(evaluated('let a: [uint8] = [1]; String(delete (a[9]));')).toBe('true');
});

test('known computed keys obey sealing', () => {
  expectStaticTypeError('class C { x: uint8 = 1; } function f(c: C) { c["extra"] = 1; }');
  expectStaticTypeError('class C { x: uint8 = 1; } const key = "extra"; function f(c: C) { c[key] = 1; }');
  expect(evaluated('dynamic class C { x: uint8 = 1; } let c: C = new C(); c["extra"] = 2; String(c.extra);')).toBe('2');
  expect(evaluated('class C { x: uint8 = 1; } let c: C = new C(); (c["x"]) = 2; String(c.x);')).toBe('2');
  expect(evaluated('class B { set extra(v) {} } class C extends B { x: uint8 = 1; } let c: C = new C(); c["extra"] = 2; String(c.x);')).toBe('1');
});

test('only the declaring constructor may write its readonly fields', () => {
  expectStaticTypeError('class C { readonly x: uint8 = 1; constructor() { const g = () => { this.x = 2; }; g(); } }');
  expectStaticTypeError('class B { readonly x: uint8 = 1; } class D extends B { constructor() { super(); this.x = 2; } }');
  expect(evaluated('class C { readonly x: uint8 = 1; constructor() { (this.x) = 2; } } String(new C().x);')).toBe('2');
});

test.each(['c.x = 2', '(c.x) = 2', '(c.x)++', 'c["x"] = 2'])(
  'readonly value copies enforce %s at an any boundary', (write) => {
    expectThrownKind(`class C { readonly x: uint8 = 1; } const original: C = new C(); const copy: C = original; function f(c: any) { ${write}; } f(copy);`, 'TypeError');
  },
);
