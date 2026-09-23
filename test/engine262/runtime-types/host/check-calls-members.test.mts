import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

test.each([
  'function take(x: uint8) {} function f() { take(x: "s"); }',
  'function take(x: uint8, y: string) {} function f() { take(y: "s"); }',
  'function take(ref x: uint8) {} function f() { take(x: 1); }',
  'function take(x: uint8, ...tail: [].<string>) {} function f() { take(x: 1, tail: (1 := uint8)); }',
  'function take(x: uint8) {} function f() { take?.("s"); }',
  'function take(x: uint8) {} function f(o: any) { o?.[take("s")]; }',
  'function tag(strings: any, x: uint8) {} function f() { tag`x${"s"}`; }',
  'class C<T: type> { constructor(x: T) {} } function f() { new C.<uint8>("s"); }',
  'function f(o: { n: uint8 }) { new o.n(); }',
  'function f(x: { a: uint8 } | null) { x.a; }',
  'function f(x: { a: uint8 }) { x["a"] = "s"; }',
  'function f(x: { [key: string]: uint8 }) { x["a"] = "s"; }',
  'function f(): uint8 { return 1; } function g() { let s: string = f?.(); }',
])('checks an equivalent call or member form: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'function take(x: uint8, y: string) {} function f() { take(y: "s", x: 1); }',
  'function take(x: uint8 = 1, y: string = "s") {} function f() { take(y: "s"); }',
  'function take(x: uint8, ...tail: [].<string>) {} function f() { take(x: 1, tail: "s"); }',
  'function take(x: uint8) {} function f() { take?.(1); }',
  'function tag(strings: any, x: uint8) {} function f() { tag`x${1}`; }',
  'class C<T: type> { constructor(x: T) {} } function f() { new C.<uint8>(1); }',
  'function f(x: { a: uint8 }) { x["a"] = 1; }',
  'function f(x: { a: uint8 } | null) { let v: uint8 | undefined = x?.a; }',
  'class C { x: uint8; static x: string = ""; static m() { this.x = "s"; } }',
  'class C { x: uint8; m() { function f() { this.x = "s"; } } }',
])('preserves a valid call or member form: %s', (source) => {
  expect(ok(source)).toBe(true);
});


test('names pin their slots before positional values are assigned', () => {
  expect(evaluated('function f(a: string, b: uint8) { return a + ":" + String(b); } f(1, a: "x");')).toBe('x:1');
});

test('a named rest yields the required suffix', () => {
  expect(evaluated('function f(...a: [].<uint8>, b: string) { return String(a.length) + ":" + b; } f(a: 1, 2, "x");')).toBe('2:x');
});

test('named fixed arguments following a rest remain pinned', () => {
  expect(evaluated('function f(...a: [].<uint8>, b: string) { return String(a.length) + ":" + b; } f(a: 1, 2, b: "x");')).toBe('2:x');
});

test.each([
  'function f(o: {a: {b: uint8}} | null) { let x: uint8 | undefined = o?.a.b; }',
  'function f(o: {a: {b: uint8} | null} | null) { let x: uint8 | undefined = o?.a?.b; }',
  'function f(o: null) { let x: undefined = o?.a; }',
  'function f(o: any) { let x: string = o?.a.b; }',
])('types a complete optional chain: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  'function f(o: {a: {b: uint8}} | null) { let x: uint8 = o?.a.b; }',
  'function f(o: {a: {b: uint8}} | null) { (o?.a).b; }',
  'function f(o: {a: {b: uint8} | null} | null) { o?.a.b; }',
  'function f(x: {readonly a: uint8}) { x["a"] = 2; }',
  'function f(x: {a: uint8} | {a: string}) { x["a"] = "s"; }',
])('checks each live chain and writable destination: %s', expectStaticTypeError);


test.each([
  'f(xs: 1, "a", ys: 2, "b");',
  'f(ys: 2, "b", xs: 1, "a");',
])('keeps each named rest with its following parameters: %s', (call) => {
  expect(evaluated('function f(...xs: [].<uint8>, a: string, ...ys: [].<uint8>, b: string): string {'
    + ' return xs.join() + a + ys.join() + b; } ' + call)).toBe('1a2b');
});
