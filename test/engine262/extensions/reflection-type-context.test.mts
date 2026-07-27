import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * proposal-runtime-types #sec-reflection-contexts, the `Type` context.
 *
 * The table there says of it: "This is the ONE CONTEXT THIS SPECIFICATION
 * DEFINES; the rest are the decorators extension's." So it is the one whose
 * shape is already normative, and stage 0 of PLAN-decorators.md builds it
 * before any decorator context for exactly that reason.
 *
 * decorators.md adds the other half: `Reflect.Type` "is the one reflection
 * target that is not also a decorator context - a bare type expression carries
 * no decorator" - so it appears in the reflection signatures and nowhere in the
 * replacement, `addInitializer`, or decorator-context tables.
 */

test('Reflect.Type is a named reflection context', () => {
  expect(evaluated('typeof Reflect.Type;')).toBe('object');
  // The context form is how the specification writes every reflection request,
  // and it answers with the same structure the value form produces - so a
  // walker can reach a type either way and see one shape.
  expect(evaluated('Reflect.getReflection.<Reflect.Type, uint8>().kind;')).toBe('primitive');
  expect(evaluated('type U = uint8 | string; String(Reflect.getReflection.<Reflect.Type, U>().kind === Reflect.getReflection(U).kind);')).toBe('true');
});

test('Reflect.Type discriminates every structural form', () => {
  // "Its reflection is discriminated by `kind` over the structural forms a type
  // can take. Every `type`, `element`, and `arm` field is ITSELF A TYPE OBJECT,
  // so a walker recurses by reflecting it again."
  //
  // The recursion is the assertion that matters: a reflection reporting the
  // right `kind` while handing back nothing to recurse into would pass a
  // kind-only test and be useless to a walker. So each form checks that its
  // nested positions are the interned types they should be.
  const u = 'type U = uint8 | string; const u = Reflect.getReflection.<Reflect.Type, U>(); ';
  expect(evaluated(`${u} String(u.kind) + "/" + String(u.arms.length);`)).toBe('union/2');
  expect(evaluated(`${u} String(u.arms[0] === string || u.arms[0] === uint8);`)).toBe('true');

  const a = 'type A4 = [4].<uint8>; const a = Reflect.getReflection.<Reflect.Type, A4>(); ';
  expect(evaluated(`${a} String(a.kind) + "/" + String(a.element === uint8) + "/" + String(a.extent);`)).toBe('array/true/4');
  // "`[].<T>` => extent undefined; `[N].<T>` => N".
  expect(evaluated('type D = [].<uint8>; String(Reflect.getReflection.<Reflect.Type, D>().extent);')).toBe('undefined');

  const o = 'type O = { a: uint8, b?: string }; const o = Reflect.getReflection.<Reflect.Type, O>(); ';
  expect(evaluated(`${o} String(o.kind) + "/" + String(o.properties.length);`)).toBe('object/2');
  expect(evaluated(`${o} String(o.properties[0].name) + "/" + String(o.properties[0].type === uint8) + "/" + String(o.properties[1].optional);`)).toBe('a/true/true');

  const t = 'type T3 = [uint8, string]; const t = Reflect.getReflection.<Reflect.Type, T3>(); ';
  expect(evaluated(`${t} String(t.kind) + "/" + String(t.elements.length) + "/" + String(t.elements[0].rest);`)).toBe('tuple/2/false');

  // "A `function` node's `signatures` is the same overload list the function
  // reflection carries, so a bare function TYPE and a reflected function
  // DECLARATION expose their overloads through one shape."
  const f = 'type Fn = (a: uint8) => string; const f = Reflect.getReflection.<Reflect.Type, Fn>(); ';
  expect(evaluated(`${f} String(f.kind) + "/" + String(f.signatures.length);`)).toBe('function/1');

  // "An `enum` or `class` type surfaces as a `primitive` node whose `type` is
  // the nominal type; its members are reached through the existing
  // `Reflect.Enum` and `Reflect.Class` contexts, so `Reflect.Type` DOES NOT
  // DUPLICATE enum or class member reflection."
  expect(evaluated('class C { a: uint8; } Reflect.getReflection.<Reflect.Type, C>().kind;')).toBe('primitive');
});

test('a type declaration carries no decorator', () => {
  // decorators.md: `Reflect.Type` "is the one reflection target that is not also
  // a decorator context - a bare type expression carries no decorator".
  //
  // MEASURED: the grammar does not admit one at all, so this is a SyntaxError
  // rather than a type error. That answers PLAN-decorators.md §7.3, and it is
  // the stronger of the two answers - a position that cannot be written cannot
  // be written wrongly.
  expectThrown('function f(c: Reflect.Type) {} @f type X = uint8;');
});
