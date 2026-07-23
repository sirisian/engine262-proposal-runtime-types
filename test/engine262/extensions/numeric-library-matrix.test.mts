import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * proposal-runtime-types: a CONFORMANCE MATRIX for the numeric library.
 *
 * The other numeric-library suites test behaviours one at a time, chosen because
 * something interesting happens there. This one is different on purpose: it walks
 * <emu-xref href="#table-numeric-library-signatures"></emu-xref> exhaustively, every
 * listed function against every family, and asserts the shape the listing gives.
 * Its value is in the cells nobody would think to write a test for, because a
 * matrix does not know which cells are interesting.
 *
 * It exists because an inventory pass found ten functions that the specification
 * declares and the engine does not implement, with no test anywhere referring to
 * them. A facility with no tests cannot fail, so nothing reported them. The last
 * section of this file pins that gap directly, so that implementing one of them
 * makes a test fail and prompts its removal from the list.
 */

/** The families the engine has values for, with a sample every listed row accepts. */
const INTEGER_TYPES = ['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32'];
const FLOAT_TYPES = ['float16', 'float32', 'float64'];

/**
 * The listing, transcribed. `int` and `float` give what the row returns at that
 * family: 'self' for a value of the argument's type, 'int32' for the fixed return
 * `imul` has by its own definition, and 'none' where the listing gives no
 * signature and resolution therefore fails.
 */
const ROWS: readonly { fn: string, arity: number, int: 'self' | 'int32' | 'none', float: 'self' | 'none', sample?: number }[] = [
  { fn: 'abs', arity: 1, int: 'self', float: 'self' },
  { fn: 'sign', arity: 1, int: 'self', float: 'self' },
  { fn: 'min', arity: 2, int: 'self', float: 'self' },
  { fn: 'max', arity: 2, int: 'self', float: 'self' },
  { fn: 'floor', arity: 1, int: 'self', float: 'self' },
  { fn: 'ceil', arity: 1, int: 'self', float: 'self' },
  { fn: 'round', arity: 1, int: 'self', float: 'self' },
  { fn: 'trunc', arity: 1, int: 'self', float: 'self' },
  // the integer roots: an integer row, because the operation has an answer there
  { fn: 'sqrt', arity: 1, int: 'self', float: 'self' },
  { fn: 'cbrt', arity: 1, int: 'self', float: 'self' },
  // a smaller sample: the matrix is asserting the RETURN TYPE, and 4 ** 4 would
  // overflow the narrow widths and raise the RangeError the return rule requires,
  // which is a different property tested in numeric-library.test.mts
  { fn: 'pow', arity: 2, int: 'self', float: 'self', sample: 2 },
  // the transcendentals: no integer counterpart, so no integer row
  { fn: 'exp', arity: 1, int: 'none', float: 'self' },
  { fn: 'expm1', arity: 1, int: 'none', float: 'self' },
  { fn: 'log', arity: 1, int: 'none', float: 'self' },
  { fn: 'log1p', arity: 1, int: 'none', float: 'self' },
  { fn: 'log2', arity: 1, int: 'none', float: 'self' },
  { fn: 'log10', arity: 1, int: 'none', float: 'self' },
  { fn: 'sin', arity: 1, int: 'none', float: 'self' },
  { fn: 'cos', arity: 1, int: 'none', float: 'self' },
  { fn: 'tan', arity: 1, int: 'none', float: 'self' },
  { fn: 'asin', arity: 1, int: 'none', float: 'self' },
  { fn: 'acos', arity: 1, int: 'none', float: 'self' },
  { fn: 'atan', arity: 1, int: 'none', float: 'self' },
  { fn: 'sinh', arity: 1, int: 'none', float: 'self' },
  { fn: 'cosh', arity: 1, int: 'none', float: 'self' },
  { fn: 'tanh', arity: 1, int: 'none', float: 'self' },
  { fn: 'asinh', arity: 1, int: 'none', float: 'self' },
  { fn: 'acosh', arity: 1, int: 'none', float: 'self' },
  { fn: 'atanh', arity: 1, int: 'none', float: 'self' },
  { fn: 'atan2', arity: 2, int: 'none', float: 'self' },
  { fn: 'hypot', arity: 2, int: 'none', float: 'self' },
  // the exceptions, each fixed by something other than the argument's type
  { fn: 'clz32', arity: 1, int: 'self', float: 'none' },
  { fn: 'clz', arity: 1, int: 'self', float: 'none' },
  { fn: 'imul', arity: 2, int: 'int32', float: 'none' },
  { fn: 'fround', arity: 1, int: 'none', float: 'self' },
  { fn: 'f16round', arity: 1, int: 'none', float: 'self' },
];

/** A call on `fn` with `arity` arguments, each the sample value at type `t`. */
function call(fn: string, arity: number, t: string, sample: number = 4): string {
  const arg = `(${sample} := ${t})`;
  return `Math.${fn}(${Array.from({ length: arity }, () => arg).join(', ')})`;
}

// -- The matrix: every listed row against every family -------------------------
test('numeric library matrix: the integer column matches the listing', () => {
  for (const row of ROWS) {
    for (const t of INTEGER_TYPES) {
      const expr = call(row.fn, row.arity, t, row.sample);
      if (row.int === 'none') {
        // no signature at this family: resolution fails, which is a type error
        expectThrownKind(`${expr};`, 'TypeError');
      } else {
        const want = row.int === 'int32' ? 'int32' : t;
        expect(evaluated(`(${expr} is ${want}) ? "yes" : "no";`), `${row.fn} at ${t}`).toBe('yes');
      }
    }
  }
});

test('numeric library matrix: the float column matches the listing', () => {
  for (const row of ROWS) {
    for (const t of FLOAT_TYPES) {
      const expr = call(row.fn, row.arity, t, row.sample);
      if (row.float === 'none') {
        expectThrownKind(`${expr};`, 'TypeError');
      } else {
        expect(evaluated(`(${expr} is ${t}) ? "yes" : "no";`), `${row.fn} at ${t}`).toBe('yes');
      }
    }
  }
});

test('numeric library matrix: no listed row accepts a mixed-type call', () => {
  // one type per signature, so two typed arguments of different types are viable
  // at no signature at all. Only the two-argument rows can express the mistake.
  for (const row of ROWS.filter((r) => r.arity === 2)) {
    if (row.int !== 'none') {
      expectThrownKind(`Math.${row.fn}((4 := uint8), (4 := uint16));`, 'TypeError');
    }
    if (row.float !== 'none') {
      expectThrownKind(`Math.${row.fn}((4 := float32), (4 := float64));`, 'TypeError');
    }
  }
});

test('numeric library matrix: every listed row leaves the untyped call alone', () => {
  // the existing signatures over the Number type are unchanged, so an untyped
  // call still answers with a plain Number whatever the row does when typed
  for (const row of ROWS) {
    if (row.fn === 'clz') {
      // the one row with no untyped signature: the width is its whole meaning
      continue;
    }
    const args = Array.from({ length: row.arity }, () => '4').join(', ');
    expect(evaluated(`(Math.${row.fn}(${args}) is number) ? "yes" : "no";`), `untyped ${row.fn}`).toBe('yes');
  }
});

// -- Existence: every operation the numeric library clause names ---------------
test('numeric library matrix: every listed function exists', () => {
  for (const row of ROWS) {
    expect(evaluated(`String(typeof Math.${row.fn});`), `Math.${row.fn}`).toBe('function');
  }
  // and the two the listing accounts for without giving argument rows
  expect(evaluated('String(typeof Math.random);')).toBe('function');
  expect(evaluated('String(typeof Math.sumPrecise);')).toBe('function');
});

/**
 * GAP PIN. The specification declares these and the engine does not implement
 * them. They were found by an inventory pass comparing the operations the spec
 * names against the operations the suite refers to, after the error-kind audit
 * turned up `Math.divFloor` by accident.
 *
 * The checked and saturating forms are a normative table in
 * sec-checked-and-saturating-arithmetic, each "overloaded for every integer type",
 * with exact semantics: the checked forms raise a *RangeError* where the type
 * cannot represent the result, and the saturating forms return the nearest value
 * of the type instead. The floored pair is sec-floored-division, with an
 * emu-note deriving the identity that relates them.
 *
 * This test asserts that they are ABSENT, so implementing one makes it fail and
 * whoever does the work is told to move the name out of this list and into the
 * matrix above. It is a reminder, not an endorsement.
 */
test('numeric library matrix: the named arithmetic forms are specified and NOT implemented', () => {
  const specifiedButAbsent = [
    'addChecked', 'subChecked', 'mulChecked', 'divChecked',
    'addSaturating', 'subSaturating', 'mulSaturating', 'divSaturating',
    'divFloor', 'mod',
  ];
  for (const fn of specifiedButAbsent) {
    expect(evaluated(`String(typeof Math.${fn});`), `Math.${fn} is specified; if this now exists, move it into the matrix`).toBe('undefined');
  }
});

// -- The predicates table, swept the same way ----------------------------------
// <emu-xref href="#table-numeric-predicates"></emu-xref> gives four questions
// across five families. The integer and rational columns are constants, which is
// exactly the kind of cell nobody writes an individual test for.
test('numeric predicates matrix: the constant columns are constant at every width', () => {
  const PREDICATES = ['isNaN', 'isFinite', 'isInteger', 'isSafeInteger'] as const;
  const EXPECTED_AT_INTEGER = { isNaN: 'false', isFinite: 'true', isInteger: 'true', isSafeInteger: 'true' };
  for (const t of INTEGER_TYPES) {
    for (const p of PREDICATES) {
      expect(evaluated(`String(Number.${p}((4 := ${t})));`), `Number.${p} at ${t}`)
        .toBe(EXPECTED_AT_INTEGER[p]);
    }
    // the globals answer alike for the two questions they ask
    expect(evaluated(`String(isNaN((4 := ${t})));`)).toBe('false');
    expect(evaluated(`String(isFinite((4 := ${t})));`)).toBe('true');
  }
});

test('numeric predicates matrix: the float columns ask the value at every width', () => {
  for (const t of FLOAT_TYPES) {
    // a finite ordinary value
    expect(evaluated(`String(Number.isNaN((4 := ${t})));`)).toBe('false');
    expect(evaluated(`String(Number.isFinite((4 := ${t})));`)).toBe('true');
    expect(evaluated(`String(Number.isInteger((4 := ${t})));`)).toBe('true');
    // a NaN of the width, reached through a row that produces one
    expect(evaluated(`String(Number.isNaN(Math.sqrt(((0 - 1) := ${t}))));`), `NaN at ${t}`).toBe('true');
    expect(evaluated(`String(Number.isFinite(Math.sqrt(((0 - 1) := ${t}))));`)).toBe('false');
    expect(evaluated(`String(Number.isInteger(Math.sqrt(((0 - 1) := ${t}))));`)).toBe('false');
    // an infinity of the width
    expect(evaluated(`String(Number.isFinite(Math.exp((10000 := ${t}))));`), `infinity at ${t}`).toBe('false');
  }
});
