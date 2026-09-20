import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'const o = { (x: uint8): "s" };',
  'let o = { (x: uint8): 300 };',
  '({ (x: uint8): "s" });',
  'return { (x: uint8): "s" };',
  'const o = { (x: uint8): "s", x: uint8(1) };',
  'const o = { (x: uint8): "s", ...{ x: uint8(1) } };',
  'const o = { nested: { (x: uint8): "s" } };',
  'const o = Composite({ (x: uint8): "s" });',
  'const o = { ([Symbol.iterator]: uint8): "s" };',
  'const k = "x"; const o = { ([k]: uint8): "s" };',
  'const o: { x: uint8 } = { (x: uint8): "s" };',
])('each own-property definition checks its initializer: %s', (body) => {
  expectStaticTypeError(`function unused() { ${body} }`);
});

test('valid literals retain contextual representation, including discarded literals', () => {
  expect(evaluated('const o = { (x: uint8): 1 }; String(Reflect.typeOf(o.x) === uint8);')).toBe('true');
  expect(evaluated('const o = { ([Symbol.iterator]: uint8): 1 }; String(o[Symbol.iterator]);')).toBe('1');
  expect(ok('({ (x: uint8): 1 });')).toBe(true);
  expect(evaluated('const o = { (x: rational): 1 / 3 }; String(o.x);')).toBe('1/3');
  expect(evaluated('const o = { (x: decimal64): 1.00 }; String(o.x);')).toBe('1.00');
});

test('computed keys and initializers execute once and in source order', () => {
  expect(evaluated(`let log = '';
    function key() { log += 'k'; return 'x'; }
    function value() { log += 'v'; return uint8(1); }
    const o = { ([key()]: uint8): value() }; String(log);`)).toBe('kv');
});

test('unknown values retain the runtime boundary and untyped properties remain dynamic', () => {
  expect(ok('function f(x: any) { return { (x: uint8): x }; } f(uint8(1));')).toBe(true);
  expectThrownKind('function f(x: any) { return { (x: uint8): x }; } f("s");', 'TypeError');
  expect(ok('const o = { x: "s" };')).toBe(true);
});
