import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-object-types: a member's |Initializer| is its DECLARED DEFAULT, and "a
 * default is a construction feature ... an object literal taking the type, a
 * typed parse (CoerceJSONValue), and a typed composite creation".
 *
 * A structural object type parsed the default and dropped it, so only the
 * `interface` spelling honoured one, although the clause says an object type
 * "is the inline form of an interface" and draws no distinction between them.
 *
 * The drop was in CANONICALIZATION, not in either resolution: intern.mts
 * rebuilds every property record from an explicit field list, so a default
 * reached that map and did not leave it. Storing it where the type is resolved
 * had no observable effect until the rebuild carried it.
 */

const S = 'type S = { id: uint32, page?: uint8 = 9 }; ';
const I = 'interface I { id: uint32; page?: uint8 = 9 } ';

test('a typed composite creation fills the declared default, both spellings', () => {
  expect(evaluated(`${S} String(Composite.<S>({ id: 1 }).page);`)).toBe('9');
  expect(evaluated(`${I} String(Composite.<I>({ id: 1 }).page);`)).toBe('9');
});

test('a typed parse fills it too', () => {
  expect(evaluated(`${S} String(JSON.parse.<S>('{"id":1}').page);`)).toBe('9');
  expect(evaluated(`${I} String(JSON.parse.<I>('{"id":1}').page);`)).toBe('9');
});

test('the two spellings of one key intern together', () => {
  // #sec-composite-typeobject-call: the default "is written here, before
  // freezing and before interning", which is what this buys. While it was
  // dropped, a composite keyed on a structural shape had two identities where
  // the clause promises one.
  expect(evaluated(`${S} String(Composite.<S>({ id: 1 }) === Composite.<S>({ id: 1, page: 9 }));`)).toBe('true');
  expect(evaluated(`${I} String(Composite.<I>({ id: 1 }) === Composite.<I>({ id: 1, page: 9 }));`)).toBe('true');
});

test('a supplied value still wins, and a member with no default stays absent', () => {
  expect(evaluated(`${S} String(Composite.<S>({ id: 1, page: 3 }).page);`)).toBe('3');
  expect(evaluated("type N = { id: uint32, page?: uint8 }; String('page' in Composite.<N>({ id: 1 }));")).toBe('false');
});

test('the default is converted to the member type, and is not limited to numbers', () => {
  expect(evaluated(`${S} String(Reflect.typeOf(Composite.<S>({ id: 1 }).page) === uint8);`)).toBe('true');
  expect(evaluated('type T = { a?: string = "hi" }; String(Composite.<T>({}).a);')).toBe('hi');
});

test('a required member is still required, default or not', () => {
  // The clause is explicit that a default does not make a member optional: it
  // is "a type error if a |TypeMember|'s |Initializer| appears without `?`".
  expect(evaluated(`${S} let threw = 'no'; try { Composite.<S>({}); } catch (e) { threw = e.constructor.name; } threw;`)).toBe('TypeError');
});

test('the default survives reflection and a builder that rebuilds the type', () => {
  // #table-reflection-nodes lists `initial` on a property record. Without it a
  // builder spreading what reflection emitted stripped the default while
  // appearing to preserve the member.
  expect(evaluated(`${S} String(Reflect.getReflection(S).properties[1].initial);`)).toBe('9');
  expect(evaluated(`${S} String(Reflect.makeType(Reflect.getReflection(S)) === S);`)).toBe('true');
  expect(evaluated(`${S} let R = Reflect.makeType({ ...Reflect.getReflection(S),
    properties: Reflect.getReflection(S).properties.map(p => ({ ...p, readonly: true })) });
    String(Composite.<R>({ id: 1 }).page);`)).toBe('9');
  // Emitted uniformly, so the record has one shape.
  expect(evaluated("type N = { a?: uint8 }; String('initial' in Reflect.getReflection(N).properties[0]);")).toBe('true');
});

test('an object literal AT the type is filled; a bound value is not', () => {
  // #sec-object-types: "an object literal written AT the position is fresh and
  // is being built there, so the type supplies what the literal omits; a value
  // that reached the position through a binding is not fresh and is only read".
  // The line is #sec-literal-freshness's, not a second rule.
  expect(evaluated(`${S} let v: S = { id: 1 }; String(v.page);`)).toBe('9');
  expect(evaluated(`${I} let v: I = { id: 1 }; String(v.page);`)).toBe('9');
  expect(evaluated(`${S} let v: S = { id: 1, page: 3 }; String(v.page);`)).toBe('3');
  expect(evaluated(`${S} let v: S = { id: 1 }; String(Reflect.typeOf(v.page) === uint8);`)).toBe('true');
  // Not fresh: nothing is written onto an object the program can already observe.
  expect(evaluated(`${S} let o = { id: 1 }; let v: S = o; String('page' in v);`)).toBe('false');
  // And an untyped literal is untouched.
  expect(evaluated("let v = { id: 1 }; String('page' in v);")).toBe('false');
});

test('a default is part of what interns, in both spellings', () => {
  // #sec-object-types: "this one evaluates it once, which is what makes 'the
  // default is part of the contents that intern' a coherent statement."
  //
  // Neither order key carried it, and the two comparisons disagreed in opposite
  // directions. An OBJECT ignored the default entirely, so two types alike but
  // for a default interned as one and whichever was seen first supplied the
  // default to both - load-order crowning, which this design treats as a defect
  // everywhere else. A TUPLE compared its default by object identity, so the
  // same default written twice produced two types, because two declarations
  // evaluate to two Value objects holding the same number.
  expect(evaluated('type A = { p?: uint8 = 7 }; type B = { p?: uint8 = 7 }; String(A === B);')).toBe('true');
  expect(evaluated('type A = { p?: uint8 = 7 }; type B = { p?: uint8 = 8 }; String(A === B);')).toBe('false');
  expect(evaluated('type A = [uint8 = 7]; type B = [uint8 = 7]; String(A === B);')).toBe('true');
  expect(evaluated('type A = [uint8 = 7]; type B = [uint8 = 8]; String(A === B);')).toBe('false');
  // A string default compares by value too, not by the Value object.
  expect(evaluated('type A = { p?: string = "x" }; type B = { p?: string = "x" }; String(A === B);')).toBe('true');
  expect(evaluated('type A = { p?: string = "x" }; type B = { p?: string = "y" }; String(A === B);')).toBe('false');
  // Without defaults, nothing changes.
  expect(evaluated('type A = { p?: uint8 }; type B = { p?: uint8 }; String(A === B);')).toBe('true');
  expect(evaluated('type A = [uint8]; type B = [uint8]; String(A === B);')).toBe('true');
});
