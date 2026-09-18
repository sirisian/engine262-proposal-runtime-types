import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-enums with #annex-evaluable-fragment.
 *
 * "It is a type error if an enumerator's value is already an enumerator of
 * another enum of the same agent" - where the underlying type's values carry
 * their own identity, that is an object, a function, or a symbol.
 *
 * The checking pass evaluates a CLOSED enum declaration outright, so every rule
 * the declaration enforces is already decided there - the collision above, a
 * duplicate enumerator name, a first enumerator with no initializer under a
 * non-numeric underlying type, and the fragment. What was wrong was WHICH
 * declarations counted as closed, and what the refusal then said.
 *
 * The gate listed the fragment floor inline, and that list had drifted from the
 * annex: it omitted `JSON`, `Map` and `Set`. So a collision written with `Math`
 * was refused before the source ran and the same collision written with `JSON`
 * was not, which is a difference between two spellings of one mistake.
 */

test('a value collision is refused, whichever floor member names it', () => {
  expectStaticTypeError('enum E: object { A = Math } enum F: object { B = Math }');
  // The three the inline list had dropped.
  expectStaticTypeError('enum E: object { A = JSON } enum F: object { B = JSON }');
  expectStaticTypeError('enum E: object { A = Map } enum F: object { B = Map }');
  expectStaticTypeError('enum E: object { A = Set } enum F: object { B = Set }');
  expectStaticTypeError('enum E: symbol { A = Symbol.iterator } enum F: symbol { B = Symbol.iterator }');
});

test('the refusal says which mistake was made', () => {
  // Four distinct rules arrived as one sentence - "a closed enum initializer
  // does not satisfy its declaration" - which named the shape of the check and
  // not the mistake. The originating error is carried now, on the principle the
  // object-member default path states: "WHY it was not evaluable is the useful
  // half of the diagnostic".
  const message = (source: string) => evaluated(`try { eval(${JSON.stringify(source)}); 'no error'; } catch (e) { e.message; }`);
  expect(message('enum E: object { A = Math } enum F: object { B = Math }'))
    .toContain('is already an enumerator of');
  expect(message('enum E { A, A }')).toContain('is already an enumerator of this enum');
  expect(message('enum E: string { A }')).toContain('underlying type is not numeric');
  expect(message('enum E { A = Math.random() }')).toContain('outside the compile-time-evaluable fragment');
});

test('what the rule does not reach is still permitted', () => {
  // #sec-enums restricts the collision rule to underlying types whose values
  // carry identity: "`enum A { X = 0 }` and `enum B { Y = 0 }` declare different
  // values that this rule does not reach".
  // And they really are different values, not merely permitted ones: an
  // enumerator of a numeric enum is tagged with its enum, so `E.A === F.B` is
  // *false* even though both were written `1`.
  expect(evaluated('enum E { A = 1 } enum F { B = 1 } String(E.A === F.B);')).toBe('false');
  // Two enumerators of ONE declaration may share a value.
  expect(evaluated('enum E: object { A = Math, B = Math } String(E.A === E.B);')).toBe('true');
  // Distinct values do not collide.
  expect(evaluated('enum E: object { A = Math } enum F: object { B = JSON } String(E.A === Math);')).toBe('true');
  expect(evaluated('enum E: object { A = JSON } String(E.A === JSON);')).toBe('true');
  expect(evaluated('enum E: object { A = Map } String(E.A === Map);')).toBe('true');
});

test('a collision the pass cannot resolve is still caught at the declaration', () => {
  // An initializer naming a binding the pass cannot read is not pre-evaluated,
  // so the rule is decided where the declaration runs - which is the deferral
  // #sec-type-errors permits, and the refusal still happens.
  expectThrownKind("const s = Symbol('s'); enum E: symbol { A = s } enum F: symbol { B = s }", 'TypeError');
});
