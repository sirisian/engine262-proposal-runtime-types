import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'for (const x of o) {}',
  'const a = [...o];',
  'let [x] = o;',
  'let x; [x] = o;',
  'function* nested() { yield* o; }',
])('a known non-callable sync hook is rejected by %s', (body) => {
  expectStaticTypeError(`function unused(o: { [Symbol.iterator]: uint8 }) { ${body} }`);
});

test('nominal, inherited and specialized hooks contribute their declared types', () => {
  expectStaticTypeError('class C { [Symbol.iterator]: uint8 = 1; } function unused(c: C) { for (const x of c) {} }');
  expectStaticTypeError('class B<T: type> { [Symbol.iterator]: T; } class C extends B.<uint8> {} function unused(c: C) { [...c]; }');
});

test('async selection rejects a present numeric hook without sync fallback', () => {
  expectStaticTypeError('async function unused(o: { [Symbol.asyncIterator]: uint8 }) { for await (const x of o) {} }');
  expectStaticTypeError('async function* unused(o: { [Symbol.asyncIterator]: uint8 }) { yield* o; }');
  expectStaticTypeError('async function unused(o: { [Symbol.asyncIterator]: uint8, [Symbol.iterator]: () => Iterator.<uint8> }) { for await (const x of o) {} }');
});

test('nullish async hooks select the synchronous protocol', () => {
  expectStaticTypeError('async function unused(o: { [Symbol.asyncIterator]: undefined, [Symbol.iterator]: uint8 }) { for await (const x of o) {} }');
  expectStaticTypeError('async function unused(o: { [Symbol.asyncIterator]?: uint8, [Symbol.iterator]: uint8 }) { for await (const x of o) {} }');
  expect(ok('async function unused(o: { [Symbol.asyncIterator]: null, [Symbol.iterator]: () => Iterator.<uint8> }) { for await (const x of o) {} }')).toBe(true);
  expect(ok('async function unused(o: { [Symbol.asyncIterator]?: uint8, [Symbol.iterator]: () => Iterator.<uint8> }) { for await (const x of o) {} }')).toBe(true);
});

test('all-invalid unions are rejected while a callable alternative is retained', () => {
  expectStaticTypeError('function unused(o: { [Symbol.iterator]: uint8 } | { [Symbol.iterator]: string }) { [...o]; }');
  expectStaticTypeError('function unused(o: { [Symbol.iterator]: uint8 | string }) { [...o]; }');
  expectStaticTypeError('function unused(o: { [Symbol.iterator]: uint8 } & { x: string }) { [...o]; }');
  expect(ok('function unused(o: { [Symbol.iterator]: uint8 | (() => Iterator.<uint8>) }) { [...o]; }')).toBe(true);
  expect(ok('function unused(o: { [Symbol.iterator]: uint8 } | object) { [...o]; }')).toBe(true);
});

test('structural and inherited callable hooks remain usable', () => {
  expect(evaluated(`class C { *[Symbol.iterator](): uint8 { yield 1; } } class D extends C {}
    function f(c: D) { return [...c]; } String(f(new D()));`)).toBe('1');
  expect(ok('function f(s: string, a: [].<uint8>) { [...s]; [...a]; } f("abc", [1]);')).toBe(true);
});

test('unknown members, open function objects and other symbol identities remain dynamic', () => {
  expect(ok('function f(o: object) { [...o]; } f([1]);')).toBe(true);
  expect(ok('function unused(o: { [Symbol.iterator]: object }) { [...o]; }')).toBe(true);
  expect(ok('const k = Symbol(); function f(o: { [k]: uint8 }) { [...o]; } let v = { [k]: uint8(1), *[Symbol.iterator]() { yield 1; } }; f(v);')).toBe(true);
  expectThrownKind('function f(o: any) { [...o]; } f({ [Symbol.iterator]: 1 });', 'TypeError');
});

test('named argument and object spreads do not require iteration', () => {
  expect(ok('function unused(o: { [Symbol.iterator]: uint8 }) { function f() {} f(...o); new f(...o); const p = { ...o }; }')).toBe(true);
});
