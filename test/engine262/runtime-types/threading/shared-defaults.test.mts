import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * The default of a `shared` type is its target's (#sec-defaultvalueof).
 *
 * "If _t_.[[Kind]] is ~shared~, return ? DefaultValueOf(_t_.[[Target]])." The modifier decides
 * where storage lives and nothing about the value (#sec-shared-storage), so a `shared`
 * declaration with no initializer begins as the unmarked one does. The operation had no step for
 * the kind, so every such declaration was refused for having no default - the design's own
 * `let a: shared [4].<uint8>;` among them.
 */

// A default is the zero of each field's type: a field's initializer belongs to construction.
const P = 'value class P { x: uint32; y: uint32 = 7; } value class G<T: type> { v: T; } ';

test('a shared binding with no initializer holds the default of its target', () => {
  expect(evaluated('let a: shared uint32; String(a);')).toBe('0');
  expect(evaluated('let a: shared [4].<uint8>; String(a.length) + ":" + a.join("");')).toBe('4:0000');
  expect(evaluated(`${P}let p: shared P; let q: P; String(p.x) + String(p.y) + String(p === q);`)).toBe('00true');
  expect(evaluated(`${P}let g: shared G.<uint32>; String(g.v);`)).toBe('0');
  expect(evaluated(`${P}let a: shared [2].<P>; a[1].y = 4; String(a[0].y) + String(a[1].y);`)).toBe('04');
  // An initializer is still what it was.
  expect(evaluated('let a: shared uint32 = 5; String(a);')).toBe('5');
});

test('a shared field with no initializer holds the default of its target', () => {
  expect(evaluated('class C { n: shared uint32; } String(new C().n);')).toBe('0');
  expect(evaluated(`${P}class C { f: shared P; #g: shared G.<uint32>; g() { return this.#g.v; } } const c = new C(); c.f.y = 7; String(c.f.y) + String(c.g());`)).toBe('70');
  expect(evaluated(`${P}class C { s: shared [4].<P>; } const c = new C(); c.s[3].y = 7; String(c.s.length) + String(c.s[2].y) + String(c.s[3].y);`)).toBe('407');
  // Each instance has its own storage.
  expect(evaluated('class C { n: shared uint32; } const a = new C(), b = new C(); a.n = 3; String(a.n) + String(b.n);')).toBe('30');
});

test('a type with no default has none under the modifier either', () => {
  // A symbol is a value type with no default, and `shared` adds none.
  const outcome = observeScript('value class S { s: symbol; constructor() { this.s = Symbol(); } } let a: shared [2].<S>;');
  expect(outcome.errorClass).toBeDefined();
});

test('a generic class held by reference holds shared storage of its parameters', () => {
  // #sec-threading-shared-modifier: "An open operand retains this formation obligation ... An
  // unresolved generic operand or class layout retains the existing deferral." The field's type
  // is formed once for the class, with its parameters open, and was judged there - so every
  // generic class with a `shared` field over a parameter was a TypeError when it was applied.
  const C = `${P}class C<T: type, N: uint32> { s: shared [N].<T>; one: shared T; } `;
  expect(evaluated(`${C}const c = new C.<P, 4>(); c.s[0].y = 7; c.one.y = 7; String(c.s.length) + String(c.s[0].y) + String(c.s[1].y) + String(c.one.y);`)).toBe('4707');
  expect(evaluated(`${C}const c = new C.<uint8, 2>(); c.s[1] = 9; c.one = 3; String(c.s[1]) + String(c.one);`)).toBe('93');
  // The obligation is discharged when an application closes the operand.
  expectThrown(`${C}new C.<string, 2>();`, 'which is not a value type');
  expectThrown(`${P}class R { r: uint8 = 0; } class C<T: type> { one: shared T; } new C.<R>();`, 'which is not a value type');
});

test('a shared binding of a type parameter is a question for the application', () => {
  expect(evaluated(`${P}function f<T: type>() { let s: shared T; return s; } String(f.<P>().y) + String(f.<uint8>());`)).toBe('00');
});
