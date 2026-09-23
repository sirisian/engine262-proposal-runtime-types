import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError, expectThrown, ok } from '../harness.mts';

test.each([
  'function f<T: type extends string>(x: T): T { return x; } const s = f.<uint8>;',
  'function f<T: type>(x: T): T { return x; } const s = f.<uint8, string>;',
  'function f<T: type, U: type>(x: T): T { return x; } const s = f.<uint8>;',
  'function f<N: uint8>(): void {} const s = f.<"s">;',
  'class C { m<T: type extends string>(x: T): T { return x; } } const s = new C().m.<uint8>;',
])('specialization arguments are checked at value creation: %s', (source) => {
  expectStaticTypeError(source);
  expectStaticTypeError(`function unused() { ${source} }`);
});

// #sec-type-references: a named argument that names no parameter, a name
// supplied twice, and a positional argument after a named one are Syntax
// Errors, and #sec-bindtypearguments says so again where the applied
// declaration is known statically.
test.each([
  'function f<T: type>(x: T): T { return x; } const s = f.<Missing: uint8>;',
  'function f<T: type>(x: T): T { return x; } const s = f.<T: uint8, T: string>;',
  'function f<T: type, U: type>(x: T): T { return x; } const s = f.<T: uint8, string>;',
])('a malformed named argument list is a Syntax Error at value creation: %s', (source) => {
  expectEarlyError(source, 'SyntaxError');
  expectEarlyError(`function unused() { ${source} }`, 'SyntaxError');
});

test('defaulted specializations publish a concrete type and preserve const inference', () => {
  expect(evaluated('function f<T: type, U: type = string>(x: T): T { return x; } const s = (f.<uint8>); String(s(1));')).toBe('1');
  expectStaticTypeError('function f<T: type, U: type = string>(x: T): T { return x; } const s = (f.<uint8>); function unused() { s("s"); }');
  expect(evaluated('function f<T: type, U: type = string>(x: T): T { return x; } String(f.<uint8> === f.<T: uint8, U: string>);')).toBe('true');
});

test.each(['f.<uint8>', 's.<uint8>', '(s).<string>', 's.<string>(1)'])('non-generic functions cannot be specialized: %s', (expression) => {
  const prefix = expression.startsWith('f.')
    ? 'function f(x: uint8): uint8 { return x; }'
    : 'function f<T: type>(x: T): T { return x; } const s = f.<uint8>;';
  expectStaticTypeError(`${prefix} function unused() { ${expression}; }`);
});

test('dynamic targets retain a runtime generic-capability check', () => {
  expectThrown('function f(x: uint8): uint8 { return x; } const g: any = f; g.<uint8>;', 'generic');
  expectThrown('function f<T: type>(x: T): T { return x; } const g: any = f.<uint8>; g.<string>(1);', 'generic');
  expect(ok('function f<T: type>(x: T): T { return x; } const g: any = f; const s = g.<uint8>; s(1);')).toBe(true);
});

test.each([
  'function f<...Ts: [].<type> extends uint8>() {}',
  'function f<...Ns: uint8>() {}',
  'function f<...Ts: [].<type> = uint8>() {}',
  'function f<...Ts: [].<type> = [].<uint8>>() {}',
  'function f<...Ts: [].<type> extends [].<any>, ...Us: [].<type> extends [].<uint8>>() {}',
  'type A = [].<any>; function f<...Ts: [].<type> extends A, ...Us: [].<type> extends [].<uint8>>() {}',
  'function f<...Ns: [].<uint8>, ...Ms: [].<any>>() {}',
  'class C<...Ts: [].<type> extends uint8> {}',
  'type T<...Ts: [].<type> extends uint8> = uint8;',
  'type F = <...Ts: [].<type> extends uint8>() => void;',
  'type F = (...a: [].<any>, ...b: [].<uint8>) => void;',
  'interface I { f(...a: [].<any>, ...b: [].<uint8>): void }',
  'function f(...xs: [].<any>, ...ys: [].<uint8>) {}',
  'type A = [].<any>; function f(...xs: [].<uint8>, ...ys: A) {}',
])('variadic declarations validate resolved constraints and defaults: %s', (source) => {
  expectStaticTypeError(source);
  expectStaticTypeError(`function unused() { ${source} }`);
});

test('constrained adjacent rests keep greedy allocation and the required tail', () => {
  expect(evaluated('function f(...a: [].<uint32>, ...b: [].<uint32>, c: uint32): string { return String(a.length) + "/" + String(b.length); } f(0, 1, 2);')).toBe('2/0');
  expect(ok('function f<...Ts: [].<type> = [uint8, string]>() {} f();')).toBe(true);
  expect(ok('function f<...Ts: [].<type> extends [].<uint8>, ...Us: [].<type> extends [].<uint8>>() {} f();')).toBe(true);
});

test('outer specializations close variadic declaration obligations', () => {
  expectStaticTypeError('function outer<T: type>() { function f<...Ts: [].<type> extends T>() {} } outer.<uint8>();');
  expect(ok('function outer<T: type>() { function f<...Ts: [].<type> extends T>() {} } outer.<[].<uint8>>();')).toBe(true);
  expect(ok('function outer<T: type>() { function f<...Ts: [].<type> extends T, ...Us: [].<type> extends [].<uint8>>() {} } outer.<[].<uint8>>();')).toBe(true);
  expectStaticTypeError('function outer<T: type>() { function f<...Ts: [].<type> = T>() {} } outer.<uint8>();');
  expect(ok('function outer<T: type>() { function f<...Ts: [].<type> = T>() {} } outer.<[uint8, string]>();')).toBe(true);
  expectStaticTypeError('function outer<T: type>() { function f<...Ts: [].<type> extends T, ...Us: [].<type> extends [].<uint8>>() {} } outer.<[].<any>>();');
});


test('ordinary rest constraints close at specialization', () => {
  expectStaticTypeError('function outer<T: type extends [].<any>>() { function f(...a: T, ...b: [].<uint8>) {} } outer.<[].<any>>();');
  expect(ok('function outer<T: type extends [].<any>>() { function f(...a: T, ...b: [].<uint8>) {} } outer.<[].<uint8>>();')).toBe(true);
  expectStaticTypeError('class C<T: type> { m<...Ts: [].<type> extends T>() {} } const c = C.<uint8>;');
  expect(ok('class C<T: type> { m<...Ts: [].<type> extends T>() {} } const c = C.<[].<uint8>>;')).toBe(true);
});

test('generic built-in capability belongs to the original function object', () => {
  expectThrown('const f: any = Math.abs; f.<uint8>(1);', 'generic');
  expectThrown('JSON.parse = function (x) { return x; }; const f: any = JSON.parse; f.<uint8>("1");', 'generic');
  expect(ok('const f: any = JSON.parse; const n = f.<uint8>("1");')).toBe(true);
});


test('stored specializations evaluate defaults over their own earlier bindings', () => {
  expect(evaluated('function d<...I: [].<uint32>, M: uint32 = I.length>(): uint32 { return M; } const a = d.<0, 1, 2>; const b = d.<4>; String(a()) + "/" + String(b());')).toBe('3/1');
  expect(evaluated('function d<...I: [].<uint32>, M: uint32 = I.length, N: uint32 = M>(): uint32 { return N; } const s = d.<0, 1>; String(s());')).toBe('2');
  expect(evaluated('function d<N: uint32, M: uint32 = N>(): uint32 { return M; } const s = d.<4>; String(s());')).toBe('4');
});

test('explicit application checks viability against each declared overload', () => {
  expect(ok('function f<T: type extends string>(x: T): string { return "s"; } function f<T: type extends uint8>(x: T): string { return "n"; } function unused() { f.<uint8>(1); }')).toBe(true);
  expectStaticTypeError('function f<T: type extends string>(x: T): string { return "s"; } function f<T: type extends uint8>(x: T): string { return "n"; } f.<boolean>(true);');
});
