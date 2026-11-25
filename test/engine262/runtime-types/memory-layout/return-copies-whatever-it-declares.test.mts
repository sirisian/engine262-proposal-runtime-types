import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-value-type-copying: "Assigning a value of a value type, passing one as
 * an argument, and returning one each COPY it", and "the copy is NOT taken at
 * a type boundary". A return copied only where its declared or published type
 * was a value type, which is a boundary: a function, an arrow, a method or a
 * getter declared to return `any` handed back the value its operand named, so
 * a store through the result wrote the original.
 *
 * Overriding a member declared to answer a `Point`, such a getter or method
 * also made the checker's "the store is lost" false: a subclass of a value
 * class that adds no storage is admitted where its base is, and its `any`
 * method gave the receiver's own field.
 */

const P = 'value class Point { x: int32 = 0; y: int32 = 0; } const o = new Point(); ';

test('a return declared `any` copies what it returns, as one with no annotation does', () => {
  expect(evaluated(`${P} function f(): any { return o; } f().x = 1; String(o.x);`)).toBe('0');
  expect(evaluated(`${P} const f = (): any => o; f().x = 1; String(o.x);`)).toBe('0');
  expect(evaluated(`${P} class K { m(): any { return o; } } new K().m().x = 1; String(o.x);`)).toBe('0');
  expect(evaluated(`${P} class K { get g(): any { return o; } } new K().g.x = 1; String(o.x);`)).toBe('0');
  expect(evaluated('value class C { n: uint8 = 0; me(): any { return this; } } const c = new C(); c.me().n = 5; String(c.n);')).toBe('0');
  expect(evaluated('class B { data: [2].<uint8> = [0, 0]; raw(): any { return this.data; } } const b = new B(); b.raw()[0] = 7; String(b.data[0]);')).toBe('0');
  // Unchanged: no annotation, and a value type declared.
  expect(evaluated(`${P} function f() { return o; } f().x = 1; String(o.x);`)).toBe('0');
  expect(evaluated(`${P} function f(): Point { return o; } const r: any = f(); r.x = 1; String(o.x);`)).toBe('0');
});

test('what is not a value of a value type is returned as it is', () => {
  expect(evaluated('class K { o = { n: 0 }; get(): any { return this.o; } } const k = new K(); k.get().n = 7; String(k.o.n);')).toBe('7');
  expect(evaluated('class B { data: [].<uint8> = [0, 0]; raw(): any { return this.data; } } const b = new B(); b.raw()[0] = 7; String(b.data[0]);')).toBe('7');
});

test('a location, a window and a construction are not copied', () => {
  // `return ref` answers a location.
  expect(evaluated(`${P} function at(): any { return ref o; } at().x = 5; String(o.x);`)).toBe('5');
  expect(evaluated(`${P} function at(): ref Point { return ref o; } at().x = 5; String(o.x);`)).toBe('5');
  // A window is over the storage it names (#sec-span-type).
  expect(evaluated('class B { data: [4].<uint8> = [0, 0, 0, 0]; view(): Span.<uint8> { return this.data; } } const b = new B(); b.view()[0] = 7; String(b.data[0]);')).toBe('7');
  // A construction builds in the caller's slot: the constructor kept `this`, and the store reaches it.
  expect(evaluated('const seen = []; value class C { n: uint8 = 0; constructor() { seen.push(this); } } function make(): any { return new C(); } make().n = 5; String(seen[0].n);')).toBe('5');
});

test('an `any` override no longer gives a subclass the base\'s own field', () => {
  const H = `${P} value class H { p: Point = new Point(); at(): Point { return this.p; } get q(): Point { return this.p; } } value class H2 extends H { at(): any { return this.p; } get q(): any { return this.p; } } const hh: any = new H2(); `;
  expect(evaluated(`${H} hh.at().x = 1; String(hh.p.x);`)).toBe('0');
  expect(evaluated(`${H} hh.q.x = 1; String(hh.p.x);`)).toBe('0');
  const S = `${P} class Shape { o: Point = new Point(); get origin(): Point { return this.o; } } class R extends Shape { get origin(): any { return this.o; } } `;
  // Typed as `Shape`, the store is refused by the getter's declaration
  // (Question D, D6); through `any` it runs, and is to the copy.
  expect(observeScript(`${S} function nudge(s: Shape) { s.origin.x = 1; return String(s.o.x); } nudge(new R());`).diagnostic).toMatchObject({ rule: 'rt-store-to-copy' });
  expect(evaluated(`${S} function nudge(s: any) { s.origin.x = 1; return String(s.o.x); } nudge(new R());`)).toBe('0');
});
