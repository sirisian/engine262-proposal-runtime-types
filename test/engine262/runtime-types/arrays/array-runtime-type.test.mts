import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * An Array's runtime type is an ~array~ type (spec sec-runtimetypeof).
 *
 * Membership walks a value's length and elements, so `['a'] is [].<string>` is
 * true - but everything that RANKS types instead of walking values read the
 * ~object~ type describing the indices as properties, which no array type
 * relates to. Overload resolution was the visible case: with `f(x: [].<int32>)`
 * and `f(s: [].<string>)` declared, no argument could select either, however it
 * was written.
 */

const OV = "function f(x: [].<int32>): string { return 'int32'; }"
  + " function f(s: [].<string>): string { return 'string'; } ";

test('an overload may be selected by an array element type', () => {
  expect(evaluated(`${OV}f(['test']);`)).toBe('string');
  expect(evaluated(`${OV}const a: [].<int32> = [(1 := int32)]; f(a);`)).toBe('int32');
  // a declared array argument selects the same overload its contents would
  expect(evaluated(`${OV}const a: [].<string> = ['test']; f(a);`)).toBe('string');
  // and an argument matching neither is still refused
  expectThrown(`${OV}f([true]);`);
});

test('the runtime type agrees with membership', () => {
  expect(evaluated("String(['test'] is [].<string>);")).toBe('true');
  expect(evaluated("String(['test'] is [].<int32>);")).toBe('false');
  // a typed array reports the type it carries, so two of one type are one type
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<uint8> = [2];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(b));')).toBe('true');
  // and an untyped array of numbers is not the same type as a `[].<uint8>`
  expect(evaluated('const a: [].<uint8> = [1]; String(Reflect.typeOf(a) === Reflect.typeOf([1]));')).toBe('false');
});

test('an element type is inferred from an array argument', () => {
  expect(evaluated("function g<T>(v: [].<T>): string { let x: T = 'z'; return x; } g(['a']);")).toBe('z');
  expect(evaluated('function g<T>(v: [].<T>): T { return v[0]; } String(g([(1 := int32)]));')).toBe('1');
});

test('mixed, nested, and non-array values are unaffected', () => {
  expect(evaluated("function m(v: [].<number | string>): string { return 'ok'; } m([1, 'a']);")).toBe('ok');
  expect(evaluated("function n(v: [].<[].<uint8>>): string { return 'ok'; }"
    + ' const inner: [].<uint8> = [1]; n([inner]);')).toBe('ok');
  // an ordinary object still reports an object type
  expect(evaluated('String(Reflect.typeOf({ a: 1 }) === Reflect.typeOf({ a: 2 }));')).toBe('true');
  // and a single signature and scalar overloads behave as before
  expect(evaluated("function g(s: [].<string>): string { return 'ok'; } g(['test']);")).toBe('ok');
  expect(evaluated("function h(x: int32): string { return 'int32'; }"
    + " function h(s: string): string { return 'string'; } h('t');")).toBe('string');
});

test('the runtime type handles the awkward array shapes', () => {
  // a hole contributes nothing a type could name, and a cycle must not recurse
  expect(evaluated("function p(v: [].<any>): string { return 'ok'; } const s = [1, , 3]; p(s);")).toBe('ok');
  expect(evaluated("function p(v: [].<any>): string { return 'ok'; }"
    + ' const s = [1]; s.push(s); p(s);')).toBe('ok');
  // a nested typed array is described through its element
  expect(evaluated('const inner: [].<uint8> = [1]; const outer = [inner];'
    + ' String(outer is [].<[].<uint8>>);')).toBe('true');
  // the extent is part of the reported type
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const b: [4].<uint8> = [5, 6, 7, 8];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(b));')).toBe('true');
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const d: [].<uint8> = [1];'
    + ' String(Reflect.typeOf(a) === Reflect.typeOf(d));')).toBe('false');
});
