import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

test.each([
  ['named generic result', 'function pick<A: type, B: type>(a: A, b: B): B { return b; } const n = pick(b: (1 := uint8), a: "s"); function unused() { let s: string = n; }'],
  ['assignment default from any', 'let x: uint8 = 1; let source: any = {}; ({ x = "s" } = source);'],
  // A builder that writes a mutable closure is not compile-time evaluable
  // (#sec-iscompiletimeevaluable), so the annotation calling it is refused, and
  // refused BEFORE execution - the builder still never runs during checking,
  // which is what this case guarded when it expected acceptance.
  ['mutable type-builder closure', 'let calls = 0; function build() { calls++; return type uint8; } function unused(x: build()) {} String(calls);'],
])('rejects %s before execution', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  ['fresh typed getter', 'let calls = 0; const o = { get x(): uint8 { calls++; return 1; } }; String(calls);', '0'],
  ['specialized function constant', 'function id<T: type>(x: T): T { return x; } const f = id.<uint8>; String(f(1));', '1'],
  ['named generic constructor', 'class C<T: type> { x: T; constructor(x: T) { this.x = x; } } const c = new C.<uint8>(x: 1); String(c.x);', '1'],
  ['generator constant', 'function* g(): uint8 { yield 1; } const x = g(); typeof x[Symbol.iterator];', 'function'],
  ['async generator constant', 'async function* g(): uint8 { yield 1; } const x = g(); typeof x[Symbol.asyncIterator];', 'function'],
  ['hoisted var before initialization', 'function f() { const before = x; var x: uint8; return `${before}/${x}`; } f();', 'undefined/0'],
  ['heterogeneous rest storage', 'function f(...xs: [uint8, string]): string { return String(xs[0] is uint8) + "/" + xs[1] + "/" + String(xs.length is uint64); } f(1, "a");', 'true/a/true'],
  ['optional find result', 'let a: [].<uint8> = [1]; const n = a.find(() => false) ?? (2 := uint8); String(n);', '2'],
  ['typed numeric equality', 'function f(n: uint8): boolean { if (n === 2) return true; return false; } String(f(2));', 'true'],
  ['coercive equality', 'function f(n: string | number): string { return n == 5 ? "yes" : "no"; } f("5");', 'yes'],
  ['enum literal equality', 'enum E { A = 5 } let x: E.A = E.A; x == 5 ? "yes" : "no";', 'yes'],
  ['written map return', 'let a: [].<uint8> = [1]; const r = a.map((v): string => "text"); r[0] = "more text"; r[0];', 'more text'],
  ['match discriminant', 'type S = { kind: "circle", r: uint8 } | { kind: "square", s: uint8 }; function f(x: S): uint8 { return match (x) { when { kind: "circle" }: x.r; default: 0; }; } String(f({ kind: "circle", r: 2 }));', '2'],
])('preserves %s', (_name, source, result) => {
  expect(evaluated(source)).toBe(result);
});

test('a typed rest retains its storage contract through any', () => {
  expectThrownKind('function f(...xs: [].<uint8>) { let alias: any = xs; alias[0] = "s"; } f(1);', 'TypeError');
});
