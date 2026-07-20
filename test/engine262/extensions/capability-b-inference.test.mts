import { test, expect } from 'vitest';
import { evaluated, ok, bool } from '../readme/harness.mts';

/**
 * Capability B — generic literal inference under a constraint.
 *
 * At a generic function call the engine infers the type parameters from the
 * argument values (spec sec-computed-constraints): parameters bind left to right,
 * each parameter's constraint is evaluated over the bindings so far, the parameter
 * is inferred from the arguments and checked against its constraint, and the return
 * type is evaluated over the bindings. Where a parameter's evaluated constraint is
 * a literal type or a union/tuple of literal types, the inferred binding is the
 * LITERAL type of the argument's value, not the widened base (spec line 928). The
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

// ── Inference and return-type evaluation over the bindings ────────────────────
test('capability B: an unconstrained parameter is inferred and the return type resolves over it', () => {
  // id<T>(x: T): T — T is inferred from the argument's runtime type
  expect(ok('function id<T>(x: T): T { return x; } Reflect.typeOf(id((5 := uint32))) === uint32;')).toBe(true);
  // an unconstrained parameter infers the widened base of a plain value
  expect(ok('function id<T>(x: T): T { return x; } Reflect.typeOf(id("hi")) === string;')).toBe(true);
});

// ── The literal-under-constraint rule ─────────────────────────────────────────
test('capability B: a parameter constrained to a literal union binds the literal type of the argument', () => {
  // pick<K: "a" | "b">("a") binds K to the literal 'a', observable through the returned value
  expect(ok('function pick<K: "a" | "b">(k: K): K { return k; } Reflect.typeOf(pick("a")) === type "a";')).toBe(true);
  expect(ok('function pick<K: "a" | "b">(k: K): K { return k; } Reflect.typeOf(pick("b")) === type "b";')).toBe(true);
});

test('capability B: the literal binding is checked against the constraint', () => {
  // a value outside the literal union fails the constraint check
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } try { pick("z"); "no-throw"; } catch (e) { "rejected"; }')).toBe('rejected');
});

// ── The headline: String Join (847), runtime generic-call form ────────────────
test('capability B: String Join (847) — Reflect.typeOf of a generic call is the joined literal', () => {
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("-", "a", "b", "c")) === type "a-b-c" ? "ok" : "no";`)).toBe('ok');
  // an empty delimiter concatenates
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("", "a", "b", "c")) === type "abc" ? "ok" : "no";`)).toBe('ok');
  // a single element is itself
  expect(evaluated(`${kit} ${join} Reflect.typeOf(join("-", "a")) === type "a" ? "ok" : "no";`)).toBe('ok');
  // and the call still produces the right runtime string value
  expect(evaluated(`${kit} ${join} join("-", "a", "b", "c");`)).toBe('a-b-c');
});

// ── Computed constraints reading a prior binding ──────────────────────────────
test('capability B: a computed constraint is evaluated over earlier bindings, left to right', () => {
  // pair<T, U: baseOf(T)>: U's constraint reads T (bound first)
  const baseOf = 'function baseOf(T) { return T; } ';
  expect(ok(`${baseOf}function pair<T, U: baseOf(T)>(x: T, y: U): U { return y; } Reflect.typeOf(pair((5 := uint32), (7 := uint32))) === uint32;`)).toBe(true);
  // a binding that violates the computed constraint is rejected
  expect(evaluated(`${baseOf}function pair<T, U: baseOf(T)>(x: T, y: U): U { return y; } try { pair((5 := uint32), (7 := uint16)); "no-throw"; } catch (e) { "rejected"; }`)).toBe('rejected');
});

// ── The typed-literal value carrier is transparent ────────────────────────────
test('capability B: a value carrying a literal type still behaves as its underlying primitive', () => {
  // a string with a literal type concatenates, compares, and stringifies normally
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); (s + "x");')).toBe('ax');
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); (s === "a") ? "eq" : "ne";')).toBe('eq');
  expect(evaluated('function pick<K: "a" | "b">(k: K): K { return k; } let s = pick("a"); typeof s;')).toBe('string');
});

// ── The pluck example over a runtime object (structural RuntimeTypeOf) ─────────
// A generic constrained by keysOf(T), where T is inferred from a runtime object
// value, reads that object's keys and binds K to the literal key argument. This
// relies on RuntimeTypeOf giving an object value its structural type rather than
// the widened `object` primitive.
test('capability B: pluck over a runtime object infers the key literally from keysOf(T)', () => {
  const kit = 'function keysOf(T) { let ks = Reflect.getReflection(T).properties.map(p => Reflect.makeType({ kind: "literal", value: p.name, base: string })); return ks.length === 1 ? ks[0] : Reflect.makeType({ kind: "union", arms: ks }); } ';
  const pluck = 'function pluck<T, K: keysOf(T)>(o: T, key: K): K { return key; } ';
  // K binds to the literal key, observable through the returned value
  expect(evaluated(`${kit}${pluck}let user = { name: "n", age: (3 := uint32) }; Reflect.typeOf(pluck(user, "name")) === type "name" ? "ok" : "no";`)).toBe('ok');
  // a key not on the object fails the keysOf(T) constraint
  expect(evaluated(`${kit}${pluck}let user = { name: "n" }; try { pluck(user, "missing"); "no-throw"; } catch (e) { "rejected"; }`)).toBe('rejected');
});

test('capability B: a runtime object reports a structural type whose keys keysOf reads', () => {
  // Reflect.typeOf of a plain object is a structural object type, not the widened primitive
  expect(evaluated('Reflect.getReflection(Reflect.typeOf({ a: (1 := uint32), b: "s" })).kind;')).toBe('object');
  expect(evaluated('let r = Reflect.getReflection(Reflect.typeOf({ a: (1 := uint32), b: "s" })); r.properties.map(p => p.name).join(",");')).toBe('a,b');
  // same shape interns to one type; a class instance reports its class nominal instead
  expect(ok('Reflect.typeOf({ a: (1 := uint32) }) === Reflect.typeOf({ a: (2 := uint32) });')).toBe(true);
  expect(bool('class Pt { constructor() { this.x = (1 := uint32); } } let p = new Pt(); String(Reflect.typeOf(p) === Reflect.typeOf({ x: (1 := uint32) }));')).toBe(false);
});
