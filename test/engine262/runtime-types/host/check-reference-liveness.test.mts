import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, expectStaticTypeError, ok } from '../harness.mts';

const setup = 'let a: [].<uint8> = [1, 2]; a.reserve(10); let ref r = a[1]; ';

test.each([
  'a.pop(); String(r);',
  'a.pop(); r = 3;',
  'a.pop(); a.push(3); String(r);',
  'a.length = 1; a.length = 2; String(r);',
  'a.pop(); function f(ref v: uint8) { return v; } f(ref r);',
])('rejects a removed element borrow permanently: %s', (use) => {
  expectThrownKind(setup + use, 'TypeError');
});

test('removing another element preserves a live borrow', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2]; let ref r = a[0]; a.pop(); r = 3; String(a[0]);')).toBe('3');
});

test('a replaced value is still the same live element', () => {
  expect(evaluated(setup + 'a[1] = 4; String(r);')).toBe('4');
});

test('an ordinary array reference keeps ordinary property semantics', () => {
  expect(evaluated('let a = [1]; let ref r = a[0]; a.pop(); a.push(4); String(r);')).toBe('4');
});


test('a wider alias retains the actual destination write boundary', () => {
  const source = 'let a: uint8 | string = 1; let b: uint8 = 2; let ref r = a; ref r = b; r = "s";';
  expect(ok('function unused() { ' + source + ' }')).toBe(true);
  expectThrownKind(source, 'TypeError');
  expectStaticTypeError('let a: uint8 = 1; let b: uint8 | string = 2; let ref r = a; ref r = b;');
  expectStaticTypeError('function f(ref x: uint8 | string) {} let x: uint8 = 1; f(ref x);');
});

test.each([
  'let slot: uint8 = 1; let o = { get x(): uint8 { return slot; }, set x(v: uint8) { slot = v; } }; let ref r = o.x; r = "s";',
  'let target: { x: uint8 } = { x: 1 }; let wrapped: any = new Proxy(target, {}); let ref r = wrapped.x; r = "s";',
])('preserves an indirect location boundary: %s', (source) => {
  expectThrownKind(source, 'TypeError');
});
