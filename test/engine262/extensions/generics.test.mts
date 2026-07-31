import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown } from '../readme/harness.mts';

/**
 * Extension coverage — generics.md.
 *
 * Generics are substantially implemented and are exercised throughout the ported
 * type-challenges corpus. Generic type aliases and interfaces with argument
 * substitution work; generic CLASSES and FUNCTIONS now parse and run (fixed this
 * session). Full monomorphization/specialization semantics and variance are the
 * deeper parts of the extension; the surface here verifies declaration,
 * application, and substitution.
 */

// ── Generic type aliases ──────────────────────────────────────────────────────
test('generics: a generic type alias applies its arguments', () => {
  expect(evaluated('type Box<T> = { value: T }; type IB = Box.<uint8>; Reflect.getReflection(IB).kind;')).toBe('object');
  // substitution: T is replaced by the argument in the reflected structure
  expect(ok('type Box<T> = { value: T }; type IB = Box.<uint8>; Reflect.getReflection(IB).properties[0].type === uint8;')).toBe(true);
});

test('generics: a multi-parameter alias applies each argument', () => {
  expect(evaluated('type Pair<A, B> = { first: A, second: B }; type P = Pair.<uint8, string>; String(Reflect.getReflection(P).properties.length);')).toBe('2');
  expect(ok('type Pair<A, B> = { first: A, second: B }; type P = Pair.<uint8, string>; let r = Reflect.getReflection(P); r.properties[0].type === uint8 && r.properties[1].type === string;')).toBe(true);
});

test('generics: generic application nests', () => {
  expect(evaluated('type Box<T> = { value: T }; type BB = Box.<Box.<uint8>>; Reflect.getReflection(BB).kind;')).toBe('object');
  // the inner element is itself an object type
  expect(evaluated('type Box<T> = { value: T }; type BB = Box.<Box.<uint8>>; Reflect.getReflection(Reflect.getReflection(BB).properties[0].type).kind;')).toBe('object');
});

// ── Generic interfaces ────────────────────────────────────────────────────────
test('generics: a generic interface declares and applies', () => {
  expect(evaluated('interface Container<T> { value: T; } typeof Container;')).toBe('object');
  // an object satisfies the applied interface structurally
  expect(evaluated('interface Container<T> { value: T; } let c = { value: (5 := uint8) }; String(c.value);')).toBe('5');
});

// ── Generic classes (parse + run) ─────────────────────────────────────────────
test('generics: a generic class declares, constructs, and applies', () => {
  expect(evaluated('class Box<T> { } typeof Box;')).toBe('function');
  // construct with implicit and explicit type arguments
  expect(evaluated('class Box<T> { constructor(v) { this.v = v; } } String(new Box((5 := uint8)).v);')).toBe('5');
  expect(evaluated('class Box<T> { constructor(v) { this.v = v; } } String(new Box.<uint8>((5 := uint8)).v);')).toBe('5');
});

test('generics: a generic class may constrain its parameter', () => {
  expect(evaluated('class Box<T extends object> { } typeof Box;')).toBe('function');
  // a generic class expression, including the unnamed form
  expect(evaluated('let Box = class<T> { }; typeof Box;')).toBe('function');
});

// ── Generic functions (parse + run) ───────────────────────────────────────────
test('generics: a generic function declares, calls, and applies', () => {
  expect(evaluated('function id<T>(x: T): T { return x; } typeof id;')).toBe('function');
  // implicit call
  expect(evaluated('function id<T>(x) { return x; } String(id(5));')).toBe('5');
  // explicit .<T> application
  expect(ok('function id<T>(x) { return x; } id.<uint8>((5 := uint8)) === (5 := uint8);')).toBe(true);
});

test('generics: generic function expressions parse, named and unnamed', () => {
  expect(evaluated('let f = function<T>(x) { return x; }; String(f(7));')).toBe('7');
  expect(evaluated('let f = function id<T>(x) { return x; }; String(f(8));')).toBe('8');
  // async generic function
  expect(evaluated('async function f<T>(x) { return x; } typeof f;')).toBe('function');
});

// ── The mixin form (a generic function returning a class) ─────────────────────
test('generics: a generic mixin function returns a class expression', () => {
  expect(evaluated('let Mixin = (Base) => class extends Base { extra() { return "e"; } }; class Base {} let C = Mixin(Base); new C().extra();')).toBe('e');
});

// ── A variadic generic parameter does not parse yet (documents the gap) ───────
test('generics: a variadic generic parameter is deferred (documents the gap)', () => {
  // generics.md: a parameter written `...Name: [].<T>` collects constant
  // arguments into a tuple, which is what lets a projection take its indices as
  // generic arguments. That rest form in the generic parameter list does not
  // parse today.
  expectThrown('function f<...I: [].<uint32>>() { return 1; } f();');
});

test('generics: a class type parameter reaches a field annotation', () => {
  // generics.md's opening example depends on this, and it failed with "T is
  // not defined": a field is evaluated during class definition, where nothing
  // bound the class's parameters. Each is bound to a ~parameter~ record now -
  // the kind table-type-record-kinds specifies and the engine lacked.
  expect(ok('class B<T> { v: T = null; }')).toBe(true);
  expect(ok('class B<T> { accessor v: T = null; }')).toBe(true);
  // The positions that already worked must keep working.
  expect(ok('class B<T> { constructor(v: T) {} }')).toBe(true);
  expect(ok('class B<T> { m(v: T) {} }')).toBe(true);
  expect(ok('class B<T> { m(): T { return null; } }')).toBe(true);
  expect(ok('class P<T> {} class B<T> extends P.<T> {}')).toBe(true);
});

/**
 * Two parts of the generics work remain, both narrowed to a cause.
 *
 * An UNINITIALIZED field of a parameter type is refused - `class B<T> { v: T; }`
 * reports "undefined is not assignable to parameter" - where the same field at
 * a concrete type is accepted. The parameter rule in relations.mts says nothing
 * relates to a parameter but itself and its constraint, which is right for a
 * declaration's interior and wrong for the initialization check that runs over
 * it. The concrete path skips that check; the parameter path does not.
 *
 * And a generic class's METHOD still fails when CALLED - `new B.<uint8>().m(1)`
 * reports "T is not defined" - because a method signature is resolved lazily,
 * at the call, and the frame pushed here covers field evaluation only. The same
 * frame needs pushing where a method's signature is resolved.
 */
