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
  // Uninitialized too: a parameter has no default, which is what leaves the
  // field alone rather than checking `undefined` against it.
  expect(ok('class B<T> { v: T; }')).toBe(true);
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
 * A STATIC field of a parameter type is still refused - "undefined is not
 * assignable to parameter". The instance path was fixed by giving a parameter
 * no default value, which is what leaves an uninitialized field alone; static
 * fields are evaluated on a different path that does not consult it.
 *
 * And a generic class's METHOD still fails when CALLED - `new B.<uint8>().m(1)`
 * reports "T is not defined" - because a method signature is resolved lazily,
 * at the call, and the frame pushed here covers field evaluation only. The same
 * frame needs pushing where a method's signature is resolved.
 */

test('generics: a generic class is usable end to end', () => {
  // generics.md's opening example, verbatim. It failed at three separate
  // points before this: the field annotation could not resolve T, an
  // uninitialized field of a parameter type was checked against it, and the
  // constructor could not be called.
  expect(ok(`
    class A<T = uint8> {
      a: T;
      constructor(a: T) { this.a = a; }
    }
    const a = new A(5);
    const b = new A.<uint32>(1024);
  `)).toBe(true);
});

test('generics: a method of a generic class is callable', () => {
  expect(ok('class B<T> { m(v: T): T { return v; } } new B.<uint8>().m(1);')).toBe(true);
  expect(ok('class B<T> { static v: T; }')).toBe(true);
  expect(ok('class B<T> { v: T; } new B.<uint8>();')).toBe(true);
});

/**
 * What an unsubstituted parameter admits, and why it is permissive.
 *
 * A parameter is opaque INSIDE its declaration - a subtype of itself and its
 * constraint, which is what lets `m(v: T): T` return its argument. At a use
 * site it is not opaque at all: `new B.<uint8>()` has bound T, and substituting
 * that binding is the specialization work of the next phase.
 *
 * Until substitution exists, both the method frame and RequireType treat an
 * unbound parameter as admitting anything. That is deliberate and it is the
 * looser of the two errors available: enforcing against an opaque parameter
 * refuses every argument, which breaks code that works rather than code that
 * does not. When specialization lands, these become real checks - and the test
 * that will show it is `new B.<uint8>().m('s')`, which is accepted today and
 * should not be.
 */

/**
 * The method-call fix: attempted, reverted, and what it taught.
 *
 * Binding the enclosing class's type parameters in InferGenericCallBindings
 * makes a generic class's method callable - `new B.<uint8>().m(1)` goes from
 * "T is not defined" to working. Two things have to be right about it, and the
 * second was not.
 *
 * The parameters must be bound to `any`, NOT to opaque ~parameter~ records. At
 * the call the parameter has a binding, and substituting it is the
 * specialization work; an opaque parameter resolves the name and then refuses
 * every argument, since nothing is assignable to a parameter. That is stricter
 * than correct rather than looser - "T is not defined" becomes "1 is not
 * assignable to parameter", which breaks code that works rather than code that
 * does not.
 *
 * And the walk to the enclosing parameters must stop at a CLASS. Walking to any
 * enclosing declaration carrying type parameters caught a parameterized
 * `primitive` block's operators, bound their parameters to `any`, and broke
 * operator declaration per parameterization. One test caught it, which is why
 * this is reverted rather than committed. The fix is a narrower predicate, not
 * a shorter walk: a walk up the parent chain finds more than the case it was
 * written for.
 */

test('generics: an application is a distinct type', () => {
  // generics.md: "Each application - A.<uint8>, A.<uint16> - is a distinct type
  // with its own type object." Both sides had been dropping their arguments, so
  // two empty argument lists agreed and every application matched every other.
  const A = 'class A<T> { m(v: T) {} } ';
  expect(ok(`${A}const x: A.<uint8> = new A.<uint8>();`)).toBe(true);
  expect(ok(`${A}const x: A.<uint16> = new A.<uint8>();`)).toBe(false);
});

test('generics: a user generic is invariant', () => {
  // Asserted for a USER class. Invariance was only ever tested through a
  // library type before, which reaches a different path.
  expect(ok(`
    class S {} class C extends S {}
    class Box<T> { m(v: T) {} }
    const b: Box.<S> = new Box.<C>();
  `)).toBe(false);
  expect(ok(`
    class S {}
    class Box<T> { m(v: T) {} }
    const b: Box.<S> = new Box.<S>();
  `)).toBe(true);
});

/**
 * PHASE 3 - done. Kept for the diagnosis, which was most of the work.
 *
 * `const x: A.<uint16> = new A.<uint8>()` is accepted, and invariance does not
 * hold for a user generic. Neither is a gap in the comparison: nominal argument
 * comparison WORKS, which a library generic proves -
 * `const b: Map.<string, uint16> = aMapOfUint8` is correctly refused by
 * SameArgumentList.
 *
 * What is missing is that a constructed instance does not carry its arguments.
 * `A.<uint8>` in expression position evaluates to the class CONSTRUCTOR, and
 * the type arguments are parsed into a TypeArgumentsExpression that
 * NewExpression reads only for `SoA` and otherwise discards. So the instance's
 * type is `A`, with no arguments, and comparing it against `A.<uint16>`
 * compares an empty argument list against a full one - which passes, because
 * there is nothing to disagree with.
 *
 * The work is therefore: resolve the TypeArgumentsExpression's arguments for
 * any generic class, carry them through construction, and include them in the
 * instance's type record. The comparison then does the rest for free, and the
 * assertion that will show it is `new B.<uint8>().m('s')`, accepted today.
 */

test('generics: a type parameter is reachable as a value', () => {
  // sec-generic-parameters-as-values. A type is a value here, so a parameter
  // bound to one is readable as one inside the declaration - but it is not a
  // VALUE binding, so ResolveBinding cannot find it and the reference arrives
  // unresolvable. The parameter frames are where it lives.
  expect(evaluated(`
    function f<T>(x: T): boolean { return T === uint8; }
    const n: uint8 = 1;
    String(f(n));
  `)).toBe('true');

  // It is the bound type, not the declared name: an argument of a different
  // type binds a different T.
  expect(evaluated(`
    function f<T>(x: T): boolean { return T === uint8; }
    const s: uint16 = 1;
    String(f(s));
  `)).toBe('false');

  // And an ordinary undefined name still throws, which is what keeps the
  // lookup from swallowing real errors.
  expectThrown('String(nope);');
});
