import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'const f = (x: uint8) => x; new f(1);',
  'new ((x: uint8) => x)(1);',
  'const f = (x: uint8) => x; const g = f; new ((g))(1);',
  'const f: (x: uint8) => uint8 = x => x; new f(1);',
  'function* f(): uint8 { yield 1; } new f();',
  'const f = function* (): uint8 { yield 1; }; new f();',
  'async function f(): Promise.<uint8, never> { return 1; } new f();',
  'const f = async (x: uint8) => x; new f(1);',
  'async function* f(): uint8 { yield 1; } new f();',
])('a proven typed non-constructor is rejected: %s', (body) => {
  expectStaticTypeError(`function unused() { ${body} }`);
});

test.each([
  '(class { x: uint8 = 1; })();',
  'class C { x: uint8 = 1; } C();',
  'const C = class { x: uint8 = 1; }; const D = C; D();',
  'class C { x: uint8 = 1; } C?.();',
  'class C { x: uint8 = 1; } C``;',
])('ordinary invocation of a stable typed class is rejected: %s', (body) => {
  expectStaticTypeError(`function unused() { ${body} }`);
});

test('hoisted declarations and later immutable origins are checked without stale inner scopes', () => {
  expectStaticTypeError('function unused() { new f(); } function* f(): uint8 { yield 1; }');
  expectStaticTypeError('function unused() { new f(1); } const f = (x: uint8) => x;');
  expectStaticTypeError('const f = (x: uint8) => x; const g = f; function unused(f) { new g(1); }');
});

test('ordinary functions construct and classes accept new', () => {
  expect(evaluated('function F(x: uint8) { this.x = x; } String(new F(1).x);')).toBe('1');
  expect(evaluated('class C { x: uint8 = 1; } String(new C().x);')).toBe('1');
});

test.each([
  'C = function () { return 1; };',
  '(C) = function () { return 1; };',
  '[C] = [function () { return 1; }];',
  '({ f: C } = { f: function () { return 1; } });',
])('reassignment withdraws a class origin: %s', (assignment) => {
  expect(evaluated(`class C { x: uint8 = 1; } ${assignment} String(C());`)).toBe('1');
});

test('captured mutation, shadowing and mutable properties do not retain stale facts', () => {
  expect(ok('let f = (x: uint8) => x; f = function (x: uint8) { this.x = x; }; new f(1);')).toBe(true);
  expect(evaluated('class C { x: uint8 = 1; } function call() { return C(); } C = function () { return 1; }; String(call());')).toBe('1');
  expect(ok('const f = (x: uint8) => x; function unused(f) { new f(1); }')).toBe(true);
  expect(ok('const o = { f: (x: uint8) => x }; o.f = function (x: uint8) { this.x = x; return x; }; new o.f(1);')).toBe(true);
});

test('a signature-only parameter does not specify construction capability', () => {
  expect(ok('function unused(C: (x: uint8) => uint8) { new C(1); }')).toBe(true);
});

test.each([
  'new (() => 1)();',
  '(class {})();',
  'const f = () => 1; new f();',
  'const f: any = (x: uint8) => x; new f(1);',
  'function f(unrelated: uint8) { new (() => 1)(); } f(1);',
])('legacy and any-typed values retain runtime timing: %s', (source) => {
  expectThrownKind(source, 'TypeError');
});

test('direct eval withdraws mutable declaration origins', () => {
  expect(evaluated('class C { x: uint8 = 1; } eval("C = function () { return 1; }"); String(C());')).toBe('1');
});

test('a computed global property write can replace a function declaration', () => {
  expect(evaluated('function* F(): uint8 { yield 1; } globalThis["F"] = function () { this.x = 1; }; String(new F().x);')).toBe('1');
});
