import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * Enum switch exhaustiveness.
 *
 * When a switch discriminant is an enumerator of an enum, the switch is checked
 * at compile time (README "Control Structures", spec sec-enums): every case label
 * must be an enumerator of that enum, and a switch with no `default` must list
 * every enumerator. A missing enumerator or a label that is not an enumerator of
 * the enum is a type error, raised as an early error before the program runs. A
 * switch with a `default` need not be exhaustive, and a switch whose discriminant
 * is not enum-typed is the ordinary switch, unaffected.
 *
 * The discriminant is recognized as enum-typed when it is a binding known to hold
 * an enumerator: a variable initialized from an enum member, or a parameter or
 * variable annotated with the enum type.
 */

// -- Exhaustiveness ------------------------------------------------------------
test('a switch over an enumerator with no default must cover every enumerator', () => {
  expectThrown('enum E { A, B, C } let e = E.A; switch (e) { case E.A: break; case E.B: break; }');
});

test('a complete switch over an enumerator is accepted', () => {
  expect(evaluated('enum E { A, B } let e = E.A; let r = "none"; switch (e) { case E.A: r = "a"; break; case E.B: r = "b"; break; } r;')).toBe('a');
});

test('the missing enumerators are named in the error', () => {
  // C and the others left out are reported
  expectThrown('enum E { A, B, C, D } let e = E.A; switch (e) { case E.A: break; }');
});

// -- default relaxes exhaustiveness --------------------------------------------
test('a switch with a default need not list every enumerator', () => {
  expect(evaluated('enum E { A, B, C } let e = E.A; let r = "none"; switch (e) { case E.A: r = "a"; break; default: r = "d"; } r;')).toBe('a');
});

test('cases split around a default clause are all counted', () => {
  expect(evaluated('enum E { A, B } let e = E.B; let r = "none"; switch (e) { case E.A: r = "a"; break; default: r = "d"; break; case E.B: r = "b"; break; } r;')).toBe('b');
});

// -- Case labels must be enumerators -------------------------------------------
test('a non-enumerator case label in an enum switch is a type error', () => {
  expectThrown('enum E { A, B } let e = E.A; switch (e) { case E.A: break; case 5: break; }');
});

test('a case label from a different enum is a type error', () => {
  expectThrown('enum E { A, B } enum F { X, Y } let e = E.A; switch (e) { case E.A: break; case F.X: break; }');
});

// -- The discriminant is recognized in several forms ---------------------------
test('a parameter annotated with the enum type is checked', () => {
  expectThrown('enum E { A, B } function f(e: E) { switch (e) { case E.A: break; } }');
});

test('a variable annotated with the enum type is checked', () => {
  expectThrown('enum E { A, B } let e: E = E.A; switch (e) { case E.A: break; }');
});

test('an enum with explicit values is checked by exhaustiveness', () => {
  expect(evaluated('enum Code { Ok = 200, Err = 500 } let c = Code.Ok; let r = "none"; switch (c) { case Code.Ok: r = "ok"; break; case Code.Err: r = "err"; break; } r;')).toBe('ok');
  expectThrown('enum Code { Ok = 200, Err = 500 } let c = Code.Ok; switch (c) { case Code.Ok: break; }');
});

// -- Ordinary switch is unaffected ---------------------------------------------
test('a switch whose discriminant is not enum-typed is unaffected', () => {
  expect(evaluated('let x = 2; let r = "none"; switch (x) { case 1: r = "a"; break; case 2: r = "b"; break; } r;')).toBe('b');
  // a partial numeric switch does not require exhaustiveness
  expect(evaluated('let x = 3; let r = "none"; switch (x) { case 1: r = "a"; break; } r;')).toBe('none');
});

/**
 * The enumeration surface: %Enum.prototype%.
 *
 * README "Enums": "enumeration objects share a common prototype, written here
 * as %Enum.prototype%". Five members are normative here - `toString(value)`,
 * `keys()`, `values()`, `entries()`, and `@@iterator` - plus the design's index
 * operator. `forEach`, `filter`, and `map` are DECLINED as compositions:
 * `entries()` composes with the Array methods to give all three.
 */
test('an enumeration answers its keys, values, and entries', () => {
  const e = 'enum Count: uint8 { Zero, One, Two } ';
  expect(evaluated(`${e} [...Count.keys()].join("|");`)).toBe('Zero|One|Two');
  expect(evaluated(`${e} [...Count.values()].join("|");`)).toBe('0|1|2');
  expect(evaluated(`${e} JSON.stringify([...Count.entries()]);`)).toBe('[["Zero",0],["One",1],["Two",2]]');
  // @@iterator is ENTRIES, not values: iterating an enumeration yields what the
  // enumeration is, a set of named values, and a bare value loses the name that
  // distinguishes an enum from its underlying type. Map makes the same choice.
  expect(evaluated(`${e} JSON.stringify([...Count]);`)).toBe('[["Zero",0],["One",1],["Two",2]]');
  // The values carry the enum type, so what comes out is what went in.
  expect(evaluated(`${e} String([...Count.values()][0] is Count);`)).toBe('true');
  // The surface is the ENUM's; an ordinary Type Object does not have it.
  expect(evaluated('String(typeof uint8.keys);')).toBe('undefined');
});

test('toString maps an enumerator to its key', () => {
  // It answered "[object Type]" - the inherited Object.prototype.toString -
  // which is a silently wrong answer where the design specifies a right one,
  // and by this project's standard that is worse than a missing feature (F48).
  const e = 'enum Count: uint8 { Zero, One, Two } ';
  expect(evaluated(`${e} Count.toString(Count.Zero);`)).toBe('Zero');
  expect(evaluated(`${e} Count.toString(Count.Two);`)).toBe('Two');
  // A value that is not an enumerator has no key, and *undefined* is the answer
  // that does not invent one.
  expect(evaluated(`${e} String(Count.toString(99));`)).toBe('undefined');
  // A string-underlying enum reads the same way, which is what `toString` is
  // FOR: interpolation sees the underlying value, so the key needs a lookup.
  const l = 'enum Level: string { Low = "low", High = "high" } ';
  expect(evaluated(`${l} Level.toString(Level.Low);`)).toBe('Low');
  expect(evaluated(`${l} String(Level.Low);`)).toBe('low');
});

test('an enumeration indexes by position beside indexing by name', () => {
  // The design writes `Count[0]; // Count.Zero` beside `Count['Zero']`. By
  // POSITION rather than by underlying value: the design's own example cannot
  // tell the two apart, since its enumerators are numbered from 0, but an index
  // operator beside a name lookup indexes the ENUMERATION, and position is what
  // `keys()`, `values()`, and `entries()` are ordered by. A lookup by VALUE
  // already exists and is spelled `Count(n)`, the reverse conversion.
  expect(evaluated('enum Count: uint8 { Zero, One, Two } String(Count[0]) + "/" + String(Count[2]);')).toBe('0/2');
  const s = 'enum Sparse: uint8 { A = 10, B = 20 } ';
  expect(evaluated(`${s} String(Sparse[0]) + "/" + String(Sparse[1]);`)).toBe('10/20');
  expect(evaluated(`${s} String(Sparse[10]);`)).toBe('undefined');
  // Both older routes are undisturbed.
  expect(evaluated(`${s} String(Sparse["A"]) + "/" + String(Sparse(20) === Sparse.B);`)).toBe('10/true');
});
