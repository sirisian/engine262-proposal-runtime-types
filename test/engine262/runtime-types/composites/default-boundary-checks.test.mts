import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  'type T = { x: uint8 = 1 };',
  'interface T { x: uint8 = 1 }',
  'type T = [uint8 = eval("1")];',
  'interface T { x?: uint8 = eval("1") }',
  'type F = (x: uint8 = "s") => void;',
  'type F = { (x: uint8 = "s"): void };',
  'type T = [uint8 = "s"]; let t: T;',
  'type T = [uint8 = "s"]; const t: T = [];',
  'type T = [uint8 = 300]; const t: T = [];',
  'type T = { x?: uint8 = "s" }; const t: T = {};',
  'interface T { x?: uint8 = "s" } const t: T = {};',
])('known invalid defaults reject at their required boundary: %s', (source) => {
  expectStaticTypeError(source);
  expectStaticTypeError(`function unused() { ${source} }`);
});

test('a stored composite default is converted only when used', () => {
  expect(ok('type T = [uint8 = "s"];')).toBe(true);
  expect(ok('type T = { x?: uint8 = "s" };')).toBe(true);
  expect(evaluated('type T = [uint8 = "s"]; const t: T = [1]; String(t[0]);')).toBe('1');
  expect(evaluated('type T = { x?: uint8 = "s" }; const t: T = { x: 1 }; String(t.x);')).toBe('1');
  expect(evaluated('type T = [uint8 = 1 + 2]; const t: T = []; String(t[0]);')).toBe('3');
  expect(evaluated('type T = { x?: uint8 = 1 }; const t: T = {}; String(t.x);')).toBe('1');
});

test('ordinary calls supply defaults from the declared function type', () => {
  expect(evaluated('type F = (x: uint8 = 1) => uint8; const f: F = (x: uint8): uint8 => x; String(f());')).toBe('1');
  expect(evaluated('const f: (x: uint8 = 1) => uint8 = (x: uint8): uint8 => x; String(f());')).toBe('1');
  expect(evaluated('type F = (x: uint8 = 1) => uint8; const f: F = (x: uint8): uint8 => x; String(f(2));')).toBe('2');
  expect(evaluated('type F = (x: uint8 = 300) => uint8; const f: F = (x: uint8): uint8 => x; String(f());')).toBe('44');
});

test('object destructuring retains typed members and fallback contributions', () => {
  expectStaticTypeError('let o: {x: string} = {x: "s"}; function unused() { const {x} = o; const n: uint8 = x; }');
  expectStaticTypeError('function f({x}: {x: string}): uint8 { return x; }');
  expectStaticTypeError('function f({x = "s"}: {x?: uint8}): uint8 { return x; }');
  expectStaticTypeError('let o: {x?: uint8} = {}; function unused() { const {x = "s"} = o; const n: uint8 = x; }');
  expect(evaluated('function f({x = "s"}: {x?: uint8}): uint8 | string { return x; } f({});')).toBe('s');
  expect(ok('const {x} = {x: "s"}; function unused() { const n: uint8 = x; }')).toBe(true);
  expect(ok('let a: [].<string> = ["s"]; function unused() { const [x] = a; const n: uint8 = x; }')).toBe(true);
  expect(ok('let a: [].<string> = ["s"]; function unused() { const [...xs] = a; const n: uint8 = xs[0]; }')).toBe(true);
  expect(ok('let a: [string] = ["s"]; function unused() { const [...xs] = a; const n: uint8 = xs[0]; }')).toBe(true);
});
