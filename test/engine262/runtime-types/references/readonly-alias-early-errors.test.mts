import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'class C { readonly x: uint8 = 1; bad() { let ref p = this.x; p = 2; } }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; p = 2; }',
  'function unused(o: { readonly x: uint8 }) { let ref p = (o.x); ++p; }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; p += 2; }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; [p] = [uint8(2)]; }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; for (p of [uint8(2)]) {} }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; let ref q = p; q = 2; }',
  'function unused(o: { readonly x: uint8 }) { let x: uint8 = 1; let ref p = x; ref p = o.x; p = 2; }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; if (c) { ref p = o.x; } p = 2; }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { p = 2; ref p = o.x; } }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; for (; c;) { p = 2; ref p = o.x; } }',
  'function unused(o: { readonly x: uint8 }) { let ref p = o.x; const write = () => { p = 2; }; }',
  'class C { readonly x: uint8 = 1; constructor() { let ref p = this.x; (() => { p = 2; })(); } }',
  'function unused(o: { readonly x: uint8, a: string } | { x: uint8, b: string }) { let ref p = o.x; p = 2; }',
  'function unused(o: { readonly [Symbol.dispose]: uint8 }) { let ref p = o[Symbol.dispose]; p = 2; }',
  'class C { get x(): uint8 { return 1; } bad() { let ref p = this.x; p = 2; } }',
])('retains readonly permission through a known alias: %s', expectStaticTypeError);

test.each([
  'function f(o: { readonly x: uint8 }) { let ref p = o.x; const n: uint8 = p; } f({ x: uint8(1) });',
  'function f(o: { readonly x: uint8 }) { const ref p = o.x; const n: uint8 = p; } f({ x: uint8(1) });',
  'function f(o: { readonly x: uint8 }) { let ref p = o.x; let x: uint8 = 1; ref p = x; p = 2; } f({ x: uint8(1) });',
  'function f(o: { readonly x: uint8 }) { let ref p = o.x; let ref q = p; let x: uint8 = 1; ref p = x; q = 2; } f({ x: uint8(1) });',
  'function f(o: { readonly inner: { x: uint8 } }) { let ref p = o.inner; p.x = 2; } f({ inner: { x: uint8(1) } });',
  'class C { readonly x: uint8 = 1; constructor() { let ref p = this.x; p = 2; } } new C();',
  'function read(ref p: uint8): uint8 { return p; } function f(o: { readonly x: uint8 }) { read(ref o.x); } f({ x: uint8(1) });',
  'function f(o: { readonly x: uint8 }) { let ref p = o.x; { let p: uint8 = 1; p = 2; } } f({ x: uint8(1) });',
  'function f(o: any) { let ref p = o.x; p = 2; } f({ x: 1 });',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; if (c) { ref p = o.x; return; } p = 2; }',
])('preserves legal reads, writes and lexical identity: %s', (source) => expect(ok(source)).toBe(true));

test('captured rebinding withdraws stale origins, including calls before the declaration', () => {
  expect(evaluated(`let x: uint8 = 1; const o: { readonly x: uint8 } = { x: uint8(1) };
    let ref p = o.x; redirect(); p = 2;
    function redirect() { ref p = x; } String(x);`)).toBe('2');
  expect(ok(`function unused(o: { readonly x: uint8 }) {
    let ref p = o.x; const write = () => { p = 2; };
    let x: uint8 = 1; ref p = x; write();
  }`)).toBe(true);
});

test('dynamic readonly class fields reject through non-strict references', () => {
  expectThrownKind('class C { readonly x: uint8 = 1; } function write(o: any) { let ref p = o.x; p = 2; } write(new C());', 'TypeError');
  expectThrownKind('class C { readonly x: uint8 = 1; } function write(ref p: uint8) { p = 2; } function call(o: any) { write(ref o.x); } call(new C());', 'TypeError');
});


test.each([
  'function unused(o: { readonly x: uint8 }, n: number) { let x: uint8 = 1; let ref p = o.x; switch (n) { case 1: ref p = x; break; default: ref p = x; } p = 2; }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { p = 2; ref p = o.x; break; } }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { p = 2; ref p = o.x; return; } }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; outer: while (c) { p = 2; while (c) { ref p = o.x; break outer; } } }',
  'function unused(o: { readonly x: uint8 }) { let x: uint8 = 1; let ref p = o.x; do { ref p = x; } while (false); p = 2; }',
  'function unused(o: { readonly x: uint8 }) { let x: uint8 = 1; let ref p = o.x; try { throw 0; } catch { ref p = x; } finally { ref p = x; } p = 2; }',
])('abrupt paths do not contribute fictitious loop or switch edges: %s', (source) => expect(ok(source)).toBe(true));

test.each([
  'class C { #x: uint8 = 0; get x(): uint8 { return 1; } constructor() { let ref p = this.x; p = 2; } }',
  'function unused() { p = 2; } const o: { readonly x: uint8 } = { x: uint8(1) }; let ref p = o.x;',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { p = 2; ref p = o.x; continue; } }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { ref p = o.x; break; } p = 2; }',
  'function unused(o: { readonly x: uint8 }, n: number) { let x: uint8 = 1; let ref p = x; switch (n) { case 1: ref p = o.x; break; default: ref p = x; } p = 2; }',
  'function unused(o: { readonly x: uint8 }, c: boolean) { let x: uint8 = 1; let ref p = x; while (c) { p = 2; try { continue; } finally { ref p = o.x; } } }',
])('retains origins on reachable exits and stable hoisted closures: %s', expectStaticTypeError);

test('typed-boundary copies preserve readonly class field permissions', () => {
  expectThrownKind('class C { readonly x: uint8 = 1; } function write(o: C) { const view: any = o; let ref p = view.x; p = 2; } write(new C());', 'TypeError');
  expectThrownKind('class C { readonly x: uint8 = 1; } function write(o: C) { const view: any = o; view.x = 2; } write(new C());', 'TypeError');
  expectThrownKind('class Inner { readonly x: uint8 = 1; } class Outer { inner: Inner = new Inner(); } function write(o: Outer) { const view: any = o.inner; let ref p = view.x; p = 2; } write(new Outer());', 'TypeError');
});
