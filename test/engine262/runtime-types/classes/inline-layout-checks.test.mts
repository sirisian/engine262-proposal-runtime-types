import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

for (const field of ['x: C;', '#x: C;', 'x: [2].<C>;']) {
  test(`an unused class cannot contain an inline cycle through ${field}`, () => {
    expectStaticTypeError(`function unused() { class C { ${field} } }`);
  });
}

test('cycles through forward class declarations are rejected before evaluation', () => {
  expectStaticTypeError('function unused() { class C { x: D; } class D { x: C; } }');
  expectStaticTypeError('function unused() { class C { x: D; } class D { x: E; } class E { x: C; } }');
});

test('nullable and dynamic-array edges end inline recursion', () => {
  expect(evaluated('class C { x: C | null; } String(new C().x);')).toBe('null');
  expect(evaluated('class C { x: [].<C> = []; } String(new C().x.length);')).toBe('0');
});

test('finite nested classes and static fields are not inline cycles', () => {
  expect(evaluated('class P { x: uint8 = 2; } class C { p: P = new P(); } String(new C().p.x);')).toBe('2');
  expect(evaluated(`function unused() { class C { static x: C; n: uint8 = 2; } } 'ok';`)).toBe('ok');
});

test('generic and dynamic class layouts retain their resolution stage', () => {
  expect(evaluated('class C<T> { x: T; } String(new C.<uint8>().x);')).toBe('0');
  expect(evaluated('dynamic class C { x: C | null = null; } String(new C().x);')).toBe('null');
});
