import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'class C { x: uint8; } const c = ((new C())); const n = c.x;',
  'function id<T>(x: T): T { return x; } const n = (id.<uint8>(1));',
  'function value(): uint8 { return 1; } const n = value();',
  'const n = (1 := uint8);',
  'let x: uint8 = 1; const n = x;',
  'let a: [].<uint8> = [1]; const n = a[0];',
  'class C { x: uint8; } const c = new C(); const n = c.x;',
  'let x: uint8 = 1; const n = x + 1;',
])('preserves a typed const initializer: %s', (source) => {
  expectStaticTypeError(`${source} function unused() { let s: string = n; }`);
});

test.each([
  'function value(): uint8 { return 1; } const n: any = value(); function f() { let s: string = n; }',
  'function value(): any { return (1 := uint8); } const n = value(); function f() { let s: string = n; }',
  'const c = { x: 1 }; function f() { let s: string = c.x; }',
  'const K = 5; let n: uint8 = K;',
  'class C { x: uint8; } const c = new C(); c.x = 2;',
])('preserves explicit any, literal propagation and field mutability: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test('the inferred const still checks an unstable initialization', () => {
  expectThrownKind('let o: { f: () => uint8 } = { f: (): uint8 => 1 };'
    + ' function change(x: any) { x.f = () => "s"; } change(o); const n = o.f();', 'TypeError');
});
