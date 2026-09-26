import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * NaN and the infinities in the decimal types - the plan "NaN and the infinities
 * in the decimal types", N1 and O1. The values are those of the IEEE interchange
 * formats, NaN and the infinities included (#sec-decimal-floating-point-types);
 * they arrive by conversion, and an operation on them gives IEEE's result - while
 * an operation that would MAKE one from finite operands still raises: an overflow,
 * a division by zero, and IEEE's invalid operations.
 */

const outcome = (expr: string) => evaluated(`let r; try { r = String(${expr}); } catch (e) { r = e.constructor.name; } r;`);

test('decimal NaN and infinities: conversions in, explicit and at the boundary', () => {
  const cases: [string, string][] = [["NaN := decimal64", "NaN"], ["Infinity := decimal64", "Infinity"], ["-Infinity := decimal32", "-Infinity"], ["(NaN := float128) := decimal128", "NaN"], ["(() => { const f = Infinity; return decimal64(f); })()", "Infinity"], ["(() => { let b: any = (NaN := float64); let a: decimal64 = b; return a; })()", "NaN"], ["(() => { let b: any = NaN; let a: decimal64 = b; return a; })()", "NaN"], ["(NaN := decimal64) := decimal128", "NaN"], ["(-Infinity := decimal64) := decimal32", "-Infinity"]];
  for (const [expr, want] of cases) {
    expect(outcome(expr), expr).toBe(want);
  }
});

test('decimal NaN and infinities: conversions out', () => {
  const cases: [string, string][] = [["(NaN := decimal64) := float64", "NaN"], ["(Infinity := decimal64) := number", "Infinity"], ["(-Infinity := decimal64) := float128", "-Infinity"], ["(NaN := decimal64) := int32", "RangeError"], ["(Infinity := decimal64) := bigint", "RangeError"], ["(NaN := decimal64) := rational", "RangeError"], ["(() => { let b: any = (NaN := decimal64); let a: int32 = b; return a; })()", "RangeError"]];
  for (const [expr, want] of cases) {
    expect(outcome(expr), expr).toBe(want);
  }
});

test('decimal NaN and infinities: arithmetic, by O1', () => {
  const cases: [string, string][] = [["(NaN := decimal64) + decimal64.parse('1')", "NaN"], ["(Infinity := decimal64) + decimal64.parse('1')", "Infinity"], ["(-Infinity := decimal64) * decimal64.parse('2')", "-Infinity"], ["decimal64.parse('1') / (Infinity := decimal64)", "0"], ["(Infinity := decimal64) / decimal64.parse('-2')", "-Infinity"], ["decimal64.parse('5') % (Infinity := decimal64)", "5"], ["-(Infinity := decimal64)", "-Infinity"], ["-(NaN := decimal64)", "NaN"], ["(Infinity := decimal64) + (Infinity := decimal64)", "Infinity"], ["(Infinity := decimal64) - (Infinity := decimal64)", "RangeError"], ["decimal64.parse('0') * (Infinity := decimal64)", "RangeError"], ["(Infinity := decimal64) / (Infinity := decimal64)", "RangeError"], ["(Infinity := decimal64) % decimal64.parse('2')", "RangeError"], ["decimal64.parse('9e384') * decimal64.parse('10')", "RangeError"], ["decimal64.parse('1') / decimal64.parse('0')", "RangeError"], ["decimal64.parse('0') / decimal64.parse('0')", "RangeError"], ["decimal64.parse('1.5') + decimal64.parse('2.25')", "3.75"]];
  for (const [expr, want] of cases) {
    expect(outcome(expr), expr).toBe(want);
  }
});

test('decimal NaN and infinities: equality, keys, ordering, text, predicates and Math', () => {
  const cases: [string, string][] = [["(() => { const n = (NaN := decimal64); return [n == n, n === n, Object.is(n, n), new Set([n, n]).size].join(' '); })()", "false false true 1"], ["(() => { const i = (Infinity := decimal64); return [i == i, i === i, new Set([i, i]).size].join(' '); })()", "true true 1"], ["Object.is((NaN := decimal32), (NaN := decimal64))", "false"], ["Composite([(NaN := decimal64)]) === Composite([(NaN := decimal64)])", "true"], ["[(NaN := decimal64) < decimal64.parse('1'), decimal64.parse('1') < (NaN := decimal64), (NaN := decimal64) > decimal64.parse('1')].join(' ')", "false false false"], ["[(-Infinity := decimal64) < decimal64.parse('1'), decimal64.parse('1') < (Infinity := decimal64)].join(' ')", "true true"], ["[(NaN := decimal64) == NaN, (Infinity := decimal64) == Infinity].join(' ')", "false true"], ["[String((NaN := decimal64)), String((Infinity := decimal64)), String((-Infinity := decimal64))].join(' ')", "NaN Infinity -Infinity"], ["[isNaN((NaN := decimal64)), isNaN((Infinity := decimal64)), isFinite((Infinity := decimal64)), isFinite(decimal64.parse('1'))].join(' ')", "true false false true"], ["[Math.max(decimal64.parse('1'), (NaN := decimal64)), Math.max(decimal64.parse('1'), (Infinity := decimal64)), Math.abs((-Infinity := decimal64)), Math.sign((-Infinity := decimal64)), Math.sign((NaN := decimal64))].join(' ')", "NaN Infinity Infinity -1 NaN"], ["decimal64.parse('NaN')", "SyntaxError"]];
  for (const [expr, want] of cases) {
    expect(outcome(expr), expr).toBe(want);
  }
});
