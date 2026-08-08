import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-composite-modifications (Composite Modifications) - SameValueZero
 * within a typed float.
 *
 * The specification enumerates the SameValueZero equivalence classes with more
 * than one member as "the signed zeros, handled above for the Number type and
 * EACH BINARY FLOAT WIDTH, and the decimal cohorts". So `float32(-0)` and
 * `float32(+0)` are ONE class, exactly as `-0` and `+0` are for Number - while
 * SameValue keeps them apart, which is the split the design calls "the same
 * split Number already has for `+0` and `-0`".
 *
 * This had been one comparison serving both, on the reasoning that "a value type
 * has no separate zero identity ... there is no distinct -0 typed value here".
 * There is. The consequence was that a typed negative zero and a typed positive
 * zero were two Map keys where the specification makes them one.
 *
 * It is a PREREQUISITE for composites rather than a tidying: interning is
 * defined over SameValueZero, and `CanonicalizeCompositeValue` returns "the
 * positive zero of that type" for a binary float's negative zero - a step that
 * only means something if the two zeros are one class. Built on the old
 * behaviour, a composite would have stored a value that compared UNEQUAL to the
 * one its own clause says it stores.
 */

test('a typed float\'s two zeros are ONE SameValueZero class', () => {
  // Map and Set use SameValueZero, so a collection is where the class shows.
  expect(evaluated('String(new Set([float32(-0), float32(0)]).size);')).toBe('1');
  expect(evaluated('String(new Set([float64(-0), float64(0)]).size);')).toBe('1');
  expect(evaluated('const m = new Map([[float32(-0), "neg"]]); String(m.get(float32(0)));')).toBe('neg');
  expect(evaluated('String([float32(0)].includes(float32(-0)));')).toBe('true');
});

test('and TWO SameValue classes, which is the whole point of the split', () => {
  // `Object.is` distinguishes representations. Asserted beside the above,
  // because a fix that collapsed both relations would satisfy either test
  // alone - and collapsing SameValue is what would make `Object.is` unable to
  // tell apart values that print differently.
  expect(evaluated('String(Object.is(float32(-0), float32(0)));')).toBe('false');
  expect(evaluated('String(Object.is(float64(-0), float64(0)));')).toBe('false');
});

test('the Number case is untouched, since it was already right', () => {
  expect(evaluated('String(new Set([-0, 0]).size);')).toBe('1');
  expect(evaluated('String(Object.is(-0, 0));')).toBe('false');
});

test('type sensitivity ACROSS types is preserved', () => {
  // The deviation composites depend on most: SameValueZero requires one type
  // before comparing payloads, so `uint8(1)` and `1` are different keys. A fix
  // that reached for zero-insensitivity by unwrapping first would have broken
  // this, so it is asserted in the same file.
  expect(evaluated('String(new Set([uint8(1), 1]).size);')).toBe('2');
  expect(evaluated('String(new Set([float32(0), 0]).size);')).toBe('2');
  expect(evaluated('String(new Set([float32(0), float64(0)]).size);')).toBe('2');
  // And ordinary typed values still compare by value.
  expect(evaluated('String(new Set([uint8(1), uint8(1)]).size);')).toBe('1');
  expect(evaluated('String(new Set([uint8(1), uint8(2)]).size);')).toBe('2');
  expect(evaluated('String(new Set([float32(1.5), float32(1.5)]).size);')).toBe('1');
});

test('a typed NaN is one key, as an untyped one is', () => {
  // SameValueZero equates NaN with itself, which is what lets an `Atomics`
  // compareExchange loop over NaN terminate - the specification's own reason.
  expect(evaluated('String(new Set([float32(NaN), float32(NaN)]).size);')).toBe('1');
  expect(evaluated('String(Object.is(float32(NaN), float32(NaN)));')).toBe('true');
});

test('the DECIMAL cohorts now HAVE a value level, and split as specified', () => {
  // A decimal type with no value level has no cohort to canonicalize, so this
  // needs the decimal values to exist first.
  //
  // The split composites need: SameValue distinguishes cohort
  // members, SameValueZero and a Map key compare numerical value.
  expect(evaluated('let d: decimal128 = 1.0; d.toString();')).toBe('1.0');
  expect(evaluated('let a: decimal128 = 1.0; let b: decimal128 = 1.00; String(Object.is(a, b));')).toBe('false');
  expect(evaluated('let a: decimal128 = 1.0; let b: decimal128 = 1.00; '
    + 'const m = new Map(); m.set(a, "x"); String(m.get(b));')).toBe('x');
  // A decimal belongs to the decimal type of its own WIDTH.
  expect(evaluated('let d: decimal128 = 1.0; String(d is decimal128);')).toBe('true');
  expect(evaluated('let d: decimal128 = 1.0; String(d is decimal32);')).toBe('false');
  // STILL OPEN: the composite's own reduction rule - "where the type declares
  // no scale, the REDUCED member is stored".
  expect(evaluated('try { interface D { v: decimal128 } '
    + 'String(Composite.<D>({ v: 1.0 }).v.toString()); } catch (e) { e.constructor.name; }')).not.toBe('1');
});
