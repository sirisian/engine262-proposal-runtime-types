import { test, expect } from 'vitest';
import { evaluated, ok, bool, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-computed-constraints (Computed Constraints),
 * #sec-inference-through-results.
 *
 * Generic literal inference under a constraint.
 *
 * At a generic function call the engine infers the type parameters from the
 * argument values: parameters bind left to right,
 * each parameter's constraint is evaluated over the bindings so far, the parameter
 * is inferred from the arguments and checked against its constraint, and the return
 * type is evaluated over the bindings. Where a parameter's evaluated constraint is
 * a literal type or a union/tuple of literal types, the inferred binding is the
 * LITERAL type of the argument's value, not the widened base. The
 * inferred literal type is carried on the returned value (a TypedStringValue /
 * TypedNumberValue), so `Reflect.typeOf` observes it rather than the widened base.
 *
 * The headline it unblocks is String Join (challenge 847): the runtime
 * generic-function call form `Reflect.typeOf(join('-', 'a', 'b', 'c'))` is the
 * literal type `'a-b-c'`, which the corpus's return-type builder computes from the
 * inferred tuple of argument literals.
 */

// A small return-type kit reused by the join tests.
const kit = [
  'function literal(v) { return Reflect.makeType({ kind: "literal", value: v, base: Reflect.typeOf(v) }); }',
  'function litval(T) { return Reflect.getReflection(T).value; }',
  'function joinResult(P, d) { return literal(Reflect.getReflection(P).elements.map(e => litval(e.type)).join(d)); }',
].join(' ');
const join = 'function join<D: string, P: [].<string>>(delimiter: D, ...parts: P): joinResult(P, delimiter) { return parts.join(delimiter); }';

// -- Inference and return-type evaluation over the bindings --------------------
test('an unconstrained parameter is inferred and the return type resolves over it', () => {
  // id<T>(x: T): T - T is inferred from the argument's runtime type
  expect(ok('function id<T>(x: T): T { return x; } Reflect.typeOf(id((5 := uint32))) === uint32;')).toBe(true);
  // an unconstrained parameter infers the widened base of a plain value
  expect(ok('function id<T>(x: T): T { return x; } Reflect.typeOf(id("hi")) === string;')).toBe(true);
});

// -- The literal-under-constraint rule -----------------------------------------
test('a parameter constrained to a literal union binds the literal type of the argument', () => {
  // pick<K: "a" | "b">("a") binds K to the literal 'a', observable through the returned value
  expect(ok('function pick<K: "a" | "b">(k: K): K { return k; } Reflect.typeOf(pick("a")) === type "a";')).toBe(true);
  expect(ok('function pick<K: "a" | "b">(k: K): K { return k; } Reflect.typeOf(pick("b")) === type "b";')).toBe(true);
});

test('the literal binding is checked against the constraint', () => {
  // a value outside the literal union fails the constraint check
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } try { pick("z"); "no-throw"; } catch (e) { "rejected"; }')).toBe('rejected');
});

// -- The headline: String Join (847), runtime generic-call form ----------------
test('String Join (847) - Reflect.typeOf of a generic call is the joined literal', () => {
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("-", "a", "b", "c")) === type "a-b-c" ? "ok" : "no";`)).toBe('ok');
  // an empty delimiter concatenates
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("", "a", "b", "c")) === type "abc" ? "ok" : "no";`)).toBe('ok');
  // a single element is itself
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("-", "a")) === type "a" ? "ok" : "no";`)).toBe('ok');
  // and the call still produces the right runtime string value
  expect(evaluated(`${kit} ${join} join("-", "a", "b", "c");`)).toBe('a-b-c');
});

// -- Computed constraints reading a prior binding ------------------------------
test('a computed constraint is evaluated over earlier bindings, left to right', () => {
  // pair<T, U: baseOf(T)>: U's constraint reads T (bound first)
  const baseOf = 'function baseOf(T) { return T; } ';
  expect(ok(`${baseOf}function pair<T, U: baseOf(T)>(x: T, y: U): U { return y; } Reflect.typeOf(pair((5 := uint32), (7 := uint32))) === uint32;`)).toBe(true);
  // a binding that violates the computed constraint is rejected
  expect(evaluated(`${baseOf}function pair<T, U: baseOf(T)>(x: T, y: U): U { return y; } try { pair((5 := uint32), (7 := uint16)); "no-throw"; } catch (e) { "rejected"; }`)).toBe('rejected');
});

// -- The typed-literal value carrier is transparent ----------------------------
test('a value carrying a literal type still behaves as its underlying primitive', () => {
  // a string with a literal type concatenates, compares, and stringifies normally
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); (s + "x");')).toBe('ax');
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); (s === "a") ? "eq" : "ne";')).toBe('eq');
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); typeof s;')).toBe('string');
});

// -- The pluck example over a runtime object (structural RuntimeTypeOf) ---------
// A generic constrained by keysOf(T), where T is inferred from a runtime object
// value, reads that object's keys and binds K to the literal key argument. This
// relies on RuntimeTypeOf giving an object value its structural type rather than
// the widened `object` primitive.
test('pluck over a runtime object infers the key literally from keysOf(T)', () => {
  const kit = 'function keysOf(T) { let ks = Reflect.getReflection(T).properties.map(p => Reflect.makeType({ kind: "literal", value: p.name, base: string })); return ks.length === 1 ? ks[0] : Reflect.makeType({ kind: "union", members: ks }); } ';
  const pluck = 'function pluck<T, K: keysOf(T)>(o: T, key: K): K { return key; } ';
  // K binds to the literal key, observable through the returned value
  expect(evaluated(`${kit}${pluck}let user = { name: "n", age: (3 := uint32) }; Reflect.typeOf(pluck(user, "name")) === type "name" ? "ok" : "no";`)).toBe('ok');
  // a key not on the object fails the keysOf(T) constraint
  expect(evaluated(`${kit}${pluck}let user = { name: "n" }; try { pluck(user, "missing"); "no-throw"; } catch (e) { "rejected"; }`)).toBe('rejected');
});

test('a runtime object reports a structural type whose keys keysOf reads', () => {
  // Reflect.typeOf of a plain object is a structural object type, not the widened primitive
  expect(evaluated('Reflect.getReflection(Reflect.typeOf({ a: (1 := uint32), b: "s" })).kind;')).toBe('object');
  expect(evaluated('let r = Reflect.getReflection(Reflect.typeOf({ a: (1 := uint32), b: "s" })); r.properties.map(p => p.name).join(",");')).toBe('a,b');
  // same shape interns to one type; a class instance reports its class nominal instead
  expect(ok('Reflect.typeOf({ a: (1 := uint32) }) === Reflect.typeOf({ a: (2 := uint32) });')).toBe(true);
  expect(bool('class Pt { constructor() { this.x = (1 := uint32); } } let p = new Pt(); String(Reflect.typeOf(p) === Reflect.typeOf({ x: (1 := uint32) }));')).toBe(false);
});

// ---------------------------------------------------------------------------
// Literal type arguments (F165/F166)
// ---------------------------------------------------------------------------

test('a TYPE parameter given a literal argument reads as the type', () => {
  // sec-generic-parameters-as-values: a type parameter, "declared with
  // `extends` or unbounded", denotes in an expression position "the Type Object
  // bound to it". This read as the literal's VALUE - `P.length` answered 3 -
  // because the parser collapsed `:` and `extends` into one field, leaving
  // GetValue to guess from the bound record's kind, which is `literal` for a
  // type parameter given a literal argument too.
  expect(evaluated("type L = 'abc'; function f<P>() { return Reflect.getReflection(P).kind; }"
    + ' String(f.<L>());')).toBe('literal');
  expect(evaluated("type L = 'abc'; function f<P extends string>() { return Reflect.getReflection(P).kind; }"
    + ' String(f.<L>());')).toBe('literal');
  expect(evaluated("type L = 'abc'; function f<P>() { return P === L; } String(f.<L>());")).toBe('true');
});

test('a VALUE parameter still reads as its value', () => {
  // The other half, and the reason the old rule existed: the design's `y * W + x`.
  expect(evaluated("type L = 'abc'; function f<P: string>() { return String(P); } String(f.<L>());")).toBe('abc');
  expect(evaluated('type N = 5; function f<V: uint8>() { return V * 2; } String(f.<N>());')).toBe('10');
});

test('one literal serves as both kinds of argument without interference', () => {
  // Guards the dependency `bindTypeParameter` documents: the value-parameter
  // mark is keyed on the bound RECORD, which is safe only because a value
  // parameter's record is rebuilt by the argument conversion rather than being
  // the interned one. Were it interned, marking it here would mark every
  // binding of `'abc'` in the realm - and this test would read 'abc' where it
  // expects 'literal'.
  const src = "type L = 'abc';"
    + ' function v<P: string>() { return String(P); }'
    + ' function ty<P>() { return Reflect.getReflection(P).kind; }';
  expect(evaluated(`${src} String(v.<L>() + '|' + ty.<L>() + '|' + v.<L>());`)).toBe('abc|literal|abc');
  expect(evaluated(`${src} String(ty.<L>() + '|' + v.<L>() + '|' + ty.<L>());`)).toBe('literal|abc|literal');
});

test('every literal kind reaches a type parameter as a type', () => {
  for (const literal of ["'abc'", '42', 'true']) {
    expect(evaluated(`type L = ${literal}; function f<P>() { return Reflect.getReflection(P).kind; }`
      + ' String(f.<L>());')).toBe('literal');
  }
});

test('other type kinds are unaffected', () => {
  const cases: [string, string][] = [
    ['uint8', 'primitive'],
    ['{ a: uint8 }', 'object'],
    ['uint8 | string', 'union'],
    ["['a']", 'tuple'],
    ["'a' | 'b'", 'union'],
  ];
  for (const [written, kind] of cases) {
    expect(evaluated(`type L = ${written}; function f<P>() { return Reflect.getReflection(P).kind; }`
      + ' String(f.<L>());')).toBe(kind);
  }
});

test('a type variable is inferred from a CALLBACK, in both directions', () => {
  // Two omissions, one gap seen from both ends. The binding walk had no
  // [[Signatures]] case, so a callback's shape constrained nothing; and
  // `mentionsTypeParameter` had none either, so `() => K` did not count as
  // mentioning `K` - the guard that skips an unbound parameter never fired and
  // the argument was compared against the raw `() => K`. The result read like a
  // type error, `"() => uint8" is not assignable to "() => K"`, and was really
  // the absence of one.
  //
  // Asserted BOTH WAYS throughout. A refusal alone proves that something was
  // checked, never that the right thing was inferred: an earlier survey of this
  // area read six capabilities as working on the strength of refusals, and four
  // of them refused every annotation, right or wrong.
  const F = 'function f<K>(cb: () => K): K { return cb(); } ';
  expectStaticTypeError(`${F} let s: string = f(() => (1 := uint8));`);
  expect(ok(`${F} let s: uint8 = f(() => (1 := uint8));`)).toBe(true);

  // A named function argument, not only an arrow.
  const N = `${F} function c(): uint8 { return 1; } `;
  expectStaticTypeError(`${N} let s: string = f(c);`);
  expect(ok(`${N} let s: uint8 = f(c);`)).toBe(true);

  // A variable in the callback's PARAMETER position binds too, which is the
  // other half of a signature's shape.
  const P = 'function p<T>(cb: (v: T) => void, x: T): T { return x; } ';
  expectStaticTypeError(`${P} let s: string = p((v: uint8) => {}, (1 := uint8));`);
  expect(ok(`${P} let s: uint8 = p((v: uint8) => {}, (1 := uint8));`)).toBe(true);
});

test('two variables bind from one call, which is `Map.groupBy`\'s shape', () => {
  // `standardlibrary.md` gives `Map.groupBy<K, T>(items, callback): Map.<K, [].<T>>`,
  // where T comes from the items and K from the callback's RETURN and from
  // nowhere else. This is that shape written as a user generic, and it is what
  // the standard library's typed statics rest on.
  const G = 'function g<T, K>(a: [].<T>, cb: (v: T) => K): Map.<K, [].<T>> { throw new Error(); } '
    + 'const a: [].<uint8> = [1]; ';
  // Guarded by `if (false)`, so what is asserted is the STATIC property: the
  // stub returns *undefined*, which no Map annotation admits at run time, and a
  // run-time refusal would pass an `ok(...)` check for the wrong reason.
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expectStaticTypeError(guard(`${G} let m: Map.<uint8, [].<uint8>> = g(a, (v) => "k");`));
  expect(ok(guard(`${G} let m: Map.<string, [].<uint8>> = g(a, (v) => "k");`))).toBe(true);
  // The element type flows to the result as well as the key.
  expectStaticTypeError(guard(`${G} let m: Map.<string, [].<string>> = g(a, (v) => "k");`));
});

test('a type variable is inferred through an INTERFACE-typed parameter', () => {
  // `Iterable.<T>` resolves to a STRUCTURAL record with T buried inside
  // `[Symbol.iterator]`'s return, so neither the [[Arguments]] walk nor the
  // [[Element]] one could see it and `f<T>(i: Iterable.<T>)` bound nothing -
  // the most useful parameter shape a generic over a sequence can have, and the
  // one `Map.groupBy` is declared with.
  //
  // Recovered by RECONSTRUCTION: for each unbound variable, rebuild the
  // interface at that variable and ask whether it is the parameter's own type.
  // Exact, and it cannot mistake a hand-written object type for an interface.
  const F = 'function f<T>(i: Iterable.<T>): T { throw new Error(); } ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expectStaticTypeError(guard(`${F} const a: [].<uint8> = [1]; let s: string = f(a);`));
  expect(ok(guard(`${F} const a: [].<uint8> = [1]; let s: uint8 = f(a);`))).toBe(true);
  // A collection reaches it too, through the `Iterable` it DECLARES.
  expectStaticTypeError(guard(`${F} let c: Set.<uint8> = new Set(); let s: string = f(c);`));
  expect(ok(guard(`${F} let c: Set.<uint8> = new Set(); let s: uint8 = f(c);`))).toBe(true);
  // A CONCRETE interface parameter is unaffected, which is what says the change
  // is about the variable and not about the relation.
  expect(ok('function g(i: Iterable.<uint8>): void {} const a: [].<uint8> = [1]; g(a);')).toBe(true);
});

test('an INFERRED binding reaches a callback\'s unannotated parameter', () => {
  // Contextual typing was never missing: a CONCRETE parameter has always worked,
  // and so has `a.map`. What was missing is the substitution ahead of it - only
  // EXPLICIT type arguments were substituted before the parameter type was
  // pushed into the literal, so `g(a, (v) => …)` pushed the unbound
  // `(v: T) => void` and the body read `v` at the bare variable.
  //
  // This is the design's stated purpose for the standard library's signatures,
  // "so fully typed call sites infer their callbacks".
  const G = 'function g<T>(a: [].<T>, cb: (v: T) => void) {} const a: [].<uint8> = [1]; ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expectStaticTypeError(guard(`${G} g(a, (v) => { let s: string = v; });`));
  expect(ok(guard(`${G} g(a, (v) => { let s: uint8 = v; });`))).toBe(true);
  // A CONCRETE parameter and `a.map` are unaffected, which is what says the
  // change is about the substitution and not about contextual typing itself.
  expect(ok('function f(cb: (v: uint8) => void) {} f((v) => { let s: uint8 = v; });')).toBe(true);
  expectStaticTypeError('const a: [].<uint8> = [1]; a.map((x) => { let s: string = x; return 1; });');
});

test('a BLOCK-bodied callback binds a variable from its return', () => {
  // `staticType` of `(v) => { return "k"; }` answered *null*, so there was no
  // record to read a return from - while the concise `(v) => "k"` answered a
  // function type and bound. One spelling of a callback worked and the other did
  // not, and the block body is the ordinary way a callback with any substance is
  // written.
  //
  // Closed in three steps, each of which looked like the whole problem.
  //
  // (1) The block body's return was never inferred - the inference was gated on
  // the body being concise - so there was no type to bind from.
  //
  // (2) The objection recorded against un-gating it, that an empty body infers
  // *undefined* which no `void` position accepts, was an objection to the JOIN:
  // #sec-inferred-result-type collapses an all-*undefined* contribution set to
  // `void`, and the join did not. Fixed separately.
  //
  // (3) Each `return` is now read AT THE WANTED TYPE, as the concise body always
  // was, so a literal does not widen past the position that wants it; and an
  // ARGUMENT position records its contextual RETURN as well as its parameters,
  // which it did not, so the wanted type reaches the body at all.
  //
  // A wrong body is still refused - the wanted type GUIDES the contribution
  // rather than replacing it - which is the property that keeps this from making
  // every unannotated body trivially conform.
  const G = 'function gb<T, K>(i: [].<T>, cb: (v: T) => K): Map.<K, [].<T>> { throw new Error(); } '
    + 'const a: [].<uint8> = [1]; ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expect(ok(guard(`${G} let m: Map.<string, [].<uint8>> = gb(a, (v) => { return "k"; });`))).toBe(true);
  // The concise form, which DOES work, for contrast.
  expect(ok(guard(`${G} let m: Map.<string, [].<uint8>> = gb(a, (v) => "k");`))).toBe(true);
});

test('a type variable is inferred through a UNION parameter', () => {
  // `match` walked members, arguments, elements, signatures and properties, and
  // had no case for a union - so a variable inside one bound nothing and
  // `f<T>(x: [].<T> | Set.<T>)` was unconstrained however plainly the argument
  // matched an arm.
  const F = 'function f<T>(x: [].<T> | Set.<T>): T { throw new Error(); } ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expectStaticTypeError(guard(`${F} const a: [].<uint8> = [1]; let s: string = f(a);`));
  expect(ok(guard(`${F} const a: [].<uint8> = [1]; let s: uint8 = f(a);`))).toBe(true);
  // The SECOND arm binds as readily as the first.
  expectStaticTypeError(guard(`${F} let c: Set.<uint8> = new Set(); let s: string = f(c);`));
  expect(ok(guard(`${F} let c: Set.<uint8> = new Set(); let s: uint8 = f(c);`))).toBe(true);
  // A union with a plain arm - `T | undefined`, the shape an optional takes.
  const P = 'function p<T>(x: T | undefined): T { throw new Error(); } const a: uint8 = (1 := uint8); ';
  expectStaticTypeError(guard(`${P} let s: string = p(a);`));
  expect(ok(guard(`${P} let s: uint8 = p(a);`))).toBe(true);
});

test('the arm that binds is chosen by KIND, not by position', () => {
  // An arm still mentioning an unbound variable admits almost anything -
  // `IsAssignable(Set.<uint8>, [].<T>)` holds while T is free - so choosing by
  // assignability alone let the FIRST arm claim the variable whatever the
  // argument was. Measured: `[].<T> | Set.<T>` given a `Set.<uint8>` bound T
  // from the array arm, while the same union written the other way round worked.
  // Order is not supposed to decide this.
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  const forward = 'function f<T>(x: [].<T> | Set.<T>): T { throw new Error(); } ';
  const reversed = 'function h<T>(x: Set.<T> | [].<T>): T { throw new Error(); } ';
  for (const [name, decl, call] of [['forward', forward, 'f'], ['reversed', reversed, 'h']]) {
    expectStaticTypeError(guard(`${decl} let c: Set.<uint8> = new Set(); let s: string = ${call}(c);`));
    expect(ok(guard(`${decl} let c: Set.<uint8> = new Set(); let s: uint8 = ${call}(c);`)), name).toBe(true);
    expectStaticTypeError(guard(`${decl} const a: [].<uint8> = [1]; let s: string = ${call}(a);`));
    expect(ok(guard(`${decl} const a: [].<uint8> = [1]; let s: uint8 = ${call}(a);`)), name).toBe(true);
  }
});

test('a RESULT-ONLY variable is bound by the call\'s contextual type', () => {
  // `f<T>(): T` has no argument mentioning T, so the arguments bind nothing and
  // the call said nothing - every other inference in this file reads its
  // variables out of what was PASSED.
  //
  // What a call also has is the type its POSITION requires, which
  // #sec-overloading-on-return-type calls its contextual type and which
  // `staticTypeIn` already records on the node for overload resolution. This
  // reads the same record for a second purpose.
  const F = 'function f<T>(): T { throw new Error(); } ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expect(ok(guard(`${F} let n: uint8 = f(); let good: uint8 = n;`))).toBe(true);
  expectStaticTypeError(guard(`${F} let n: uint8 = f(); let bad: string = n;`));
  // A RETURN position and an ARGUMENT position supply one as readily as a
  // binding's annotation does.
  expect(ok(guard(`${F} function g(): uint8 { return f(); }`))).toBe(true);
  expect(ok(guard(`${F} function h(x: uint8) {} h(f());`))).toBe(true);
});

test('an ARGUMENT beats the contextual type', () => {
  // The context is consulted AFTER the arguments and only for variables they
  // leave unbound: an argument is a stronger statement than a position, and a
  // contextual match must not overrule what was passed.
  const P = 'function p<T>(x: T): T { return x; } const a: uint8 = (1 := uint8); ';
  const guard = (src: string) => `if (false) { ${src} } 1;`;
  expect(ok(guard(`${P} let n: uint8 = p(a);`))).toBe(true);
  expectStaticTypeError(guard(`${P} let n: string = p(a);`));
  // A signature with BOTH kinds binds each from its own source - T from the
  // argument, U from the annotation.
  const M = 'function m<T, U>(x: T): U { throw new Error(); } const a: uint8 = (1 := uint8); ';
  expect(ok(guard(`${M} let n: string = m(a); let good: string = n;`))).toBe(true);
  expectStaticTypeError(guard(`${M} let n: string = m(a); let bad: uint8 = n;`));
});
