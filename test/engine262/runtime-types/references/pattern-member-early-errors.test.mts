import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'function unused(o: { [Symbol.dispose]: uint8 }) { let { [Symbol.dispose]: n: boolean } = o; }',
  'function unused({ [Symbol.dispose]: n }: { [Symbol.dispose]: uint8 }) { n(); }',
  'function unused(o: { [Symbol.dispose]: uint8 }) { const { [Symbol.dispose]: n } = o; n(); }',
  'const K = Symbol(); function unused(o: { [K]: uint8 }) { let { [K]: n: boolean } = o; }',
  'const K = Symbol.dispose; function unused(o: { [Symbol.dispose]: uint8 }) { let { [K]: n: boolean } = o; }',
  'function unused(o: { n: uint8, a: string } | { n: uint8, b: string }) { let { n: value: boolean } = o; }',
  'function unused(o: { [Symbol.dispose]: uint8, a: string } | { [Symbol.dispose]: uint8, b: string }) { const { [Symbol.dispose]: n } = o; n(); }',
  'function unused(o: { [Symbol.dispose]?: uint8 }) { let { [Symbol.dispose]: n: uint8 } = o; }',
  'function unused(o: { n?: uint8, a: string } | { n: uint8, b: string }) { let { n: value: uint8 } = o; }',
  'function unused(o: { inner: { [Symbol.dispose]: uint8 } }) { let { inner: { [Symbol.dispose]: n: boolean } } = o; }',
  'function unused(o: { [Symbol.dispose]: uint8 }) { let n: boolean = true; ({ [Symbol.dispose]: n } = o); }',
  'function unused() { let { [Symbol.dispose]: n: boolean } = { [Symbol.dispose]: uint8(1) }; }',
])('retains a known pattern contribution: %s', expectStaticTypeError);

test('preserves dynamic bindings, unknown keys and last-writer semantics', () => {
  expect(ok('function f(o: { n: uint8 }) { let { n } = o; n = "s"; } f({ n: uint8(1) });')).toBe(true);
  expect(ok('function f(o: any) { let { [Symbol.dispose]: n: boolean } = o; } f({ [Symbol.dispose]: true });')).toBe(true);
  expect(ok('const K = Symbol(); function unused(o: { [K]: uint8 }, K: any) { const { [K]: n } = o; n(); }')).toBe(true);
  expect(ok('function unused(k: any) { let { x: n: boolean } = { x: uint8(1), [k]: true }; }')).toBe(true);
  expect(ok('function unused(o: any) { let { x: n: boolean } = { x: uint8(1), ...o }; }')).toBe(true);
  expectThrownKind('function f(o: any) { let { [Symbol.dispose]: n: boolean } = o; } f({ [Symbol.dispose]: uint8(1) });', 'TypeError');
});

test('distinct symbols and valid extraction retain their values', () => {
  expect(evaluated('const A = Symbol(); const B = Symbol(); function f(o: { [A]: uint8, [B]: boolean }) { let { [B]: b: boolean } = o; return b; } String(f({ [A]: uint8(1), [B]: true }));')).toBe('true');
  expect(evaluated('function f(o: { [Symbol.dispose]: uint8 }) { let { [Symbol.dispose]: n: uint8 } = o; return n; } String(f({ [Symbol.dispose]: uint8(1) }));')).toBe('1');
});
