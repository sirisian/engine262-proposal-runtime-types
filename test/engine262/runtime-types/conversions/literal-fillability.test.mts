import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-literal-propagation states an INVARIANT, not only a rule:
 *
 *   "A contextual type that is a ~literal~ Type Record whose [[Base]] is a
 *    numeric value type admits a numeric literal on the same terms … WITHOUT
 *    THIS SUCH A TYPE IS NAMEABLE AND NOT FILLABLE."
 *
 * An invariant is a promise about every case, and the promise was largely
 * untested: the sibling `literal-propagation.test.mts` covers the const
 * propagation feature, and between them these two files reached five of the nine
 * numeric bases and ONE of the nine positions a type can be written in. A
 * regression in `uint64`, in `uint.<7>`, or in any of the eight other positions
 * would have passed the suite while contradicting a published claim.
 *
 * These tests exist to make the claim checkable, so each one varies exactly one
 * dimension.
 */

/** A literal type of _value_ over _base_, which is the shape the clause is about. */
const lit = (value: string, base: string) => `const L = Reflect.makeType({ kind: 'literal',`
  + ` value: (${value} := ${base}), base: type ${base} }); `;

test('every numeric base admits its literal', () => {
  // The clause says "a numeric value type", so a gap at any of these would mean
  // the rule is narrower than it claims.
  expect(evaluated(`${lit('5', 'uint8')} let v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${lit('5', 'uint16')} let v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${lit('5', 'uint32')} let v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${lit('5', 'uint64')} let v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${lit('-5', 'int8')} let v: L = -5; String(Number(v));`)).toBe('-5');
  expect(evaluated(`${lit('-5', 'int32')} let v: L = -5; String(Number(v));`)).toBe('-5');
  expect(evaluated(`${lit('1.5', 'float32')} let v: L = 1.5; String(Number(v));`)).toBe('1.5');
  expect(evaluated(`${lit('1.5', 'float64')} let v: L = 1.5; String(Number(v));`)).toBe('1.5');
  // A width that is not a power of two is not a special case.
  expect(evaluated(`${lit('5', 'uint.<7>')} let v: L = 5; String(Number(v));`)).toBe('5');
});

test('every position admits it', () => {
  // "Fillable" is a claim about the type, so it has to hold wherever the type can
  // be written. Only the parameter row was covered before.
  const L = lit('5', 'uint32');
  expect(evaluated(`${L} let v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${L} const v: L = 5; String(Number(v));`)).toBe('5');
  expect(evaluated(`${L} let o: { a: L } = { a: 5 }; String(Number(o.a));`)).toBe('5');
  expect(evaluated(`${L} let a: [1].<L> = [5]; String(a.join(","));`)).toBe('5');
  expect(evaluated(`${L} let t: [L, uint8] = [5, 1]; String(Number(t[0]));`)).toBe('5');
  expect(evaluated(`${L} function f(x: L) { return Number(x); } String(f(5));`)).toBe('5');
  expect(evaluated(`${L} function g(): L { return 5; } String(Number(g()));`)).toBe('5');
  expect(evaluated(`${L} class C { a: L = 5; } String(Number(new C().a));`)).toBe('5');
  expect(evaluated(`${L} let u: L | string = 5; String(Number(u));`)).toBe('5');
  // Nesting is NOT the limit. The clause's limit is that the reach "does not
  // re-base a written literal" - a different thing, and the one `uint8 & 5`
  // tests in the sibling file.
});

test('a literal type over a non-numeric base admits its literal too', () => {
  // The clause names numerics because that is where the propagation was missing,
  // not because the rule is a numeric carve-out. Pinned so a future reader does
  // not have to guess which it is.
  expect(evaluated("const B = Reflect.makeType({ kind: 'literal', value: 5n, base: type bigint });"
    + ' let v: B = 5n; String(v);')).toBe('5');
  expect(evaluated("const S = Reflect.makeType({ kind: 'literal', value: 'a', base: type string });"
    + " let v: S = 'a'; String(v);")).toBe('a');
  expect(evaluated("const T = Reflect.makeType({ kind: 'literal', value: true, base: type boolean });"
    + ' let v: T = true; String(v);')).toBe('true');
});

test('a literal of the wrong VALUE is refused by the literal type', () => {
  expectThrown(`${lit('5', 'uint32')} let v: L = 6;`, 'is not assignable to "a literal type of uint.<32>"');
});

test('a literal the BASE cannot hold is refused by the base', () => {
  // The half that makes "the conversion is the BASE's" checkable rather than
  // decorative: the message names the base's range, not this rule. The two
  // diagnostics staying distinct is what the clause promises.
  expectThrown(`${lit('5', 'uint8')} let v: L = 300;`, 'is not in the range of "uint.<8>"');
  expectThrown(`${lit('5', 'uint8')} let v: L = -5;`, 'is not in the range of "uint.<8>"');
});

test('the boundaries the invariant must not be read to cross', () => {
  const NB = 'type NB = { bounds?: Range }; meta NB { default = {};'
    + ' subtype(a,b) { if (b.bounds === undefined) return true; if (a.bounds === undefined) return false;'
    + ' return b.bounds.contains(a.bounds); }'
    + ' validate(v,c) { return c.bounds === undefined || c.bounds.contains(Number(v)); } } ';

  // A PARAMETERIZED numeric is not this rule's business: it needs a declared
  // implicit cast (#sec-primitive-operator-blocks).
  expectThrown(`${NB} let x: uint32.<{ bounds: 5..=5 }> = 5;`,
    'is not assignable to "uint.<32>.<{ bounds: 5..=5 }>"');
  // ...and WITH the cast declared it is admitted, which is what makes the
  // exclusion principled rather than arbitrary: the type is reachable, by a
  // declaration the program writes.
  expect(evaluated(`${NB} primitive uint32 { operator uint32.<{ bounds: 5..=5 }>():`
    + ' uint32.<{ bounds: 5..=5 }> { return this; } }'
    + ' let x: uint32.<{ bounds: 5..=5 }> = 5; "accepted";')).toBe('accepted');

  // "Nameable and not fillable" is about the LITERAL grammar, not about defaults.
  // These are nameable, have no default, and are refused by #sec-defaultvalueof -
  // which is a different clause saying a different thing.
  expectThrown('let x: never;', 'has no values');
  expectThrown('let f: () => void;', 'has no default value');
  expectThrown('let u: uint8 | string;', 'has no default value');
});
