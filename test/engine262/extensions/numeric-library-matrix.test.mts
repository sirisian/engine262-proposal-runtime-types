import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../readme/harness.mts';

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
// These matrix tests evaluate one program per listed function per numeric type
// - roughly forty functions across each column - so they are legitimately slow
// rather than wrong, and vitest's default 5s timeout sits right at their
// runtime under full-suite load. The project's vitest config raises the
// default for exactly this reason (F61); the note stays here because this is
// the file that made it obvious.
test('numeric library matrix: the integer column matches the listing', () => {
  for (const row of ROWS) {
    for (const t of INTEGER_TYPES) {
      const expr = call(row.fn, row.arity, t, row.sample);
      if (row.int === 'none') {
        // no signature at this family: resolution fails, and since Phase 3
        // it fails statically, before the script runs
        expectStaticTypeError(`${expr};`);
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
        expectStaticTypeError(`${expr};`);
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
      expectStaticTypeError(`Math.${row.fn}((4 := uint8), (4 := uint16));`);
    }
    if (row.float !== 'none') {
      expectStaticTypeError(`Math.${row.fn}((4 := float32), (4 := float64));`);
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


// -- The ~any~ path: the runtime dispatch stays the backstop -------------------
test('numeric library matrix: the runtime dispatch is the backstop for the any path', () => {
  // An argument the checker cannot see reaches the same misuses at run time,
  // where the dispatch wrapper still refuses them, kind and all: the static
  // rejection did not replace the runtime rule, it fronted it.
  expectThrownKind('const via = (f, ...xs) => f(...xs); via(Math.exp, (4 := uint8));', 'TypeError');
  expectThrownKind('const via = (f, ...xs) => f(...xs); via(Math.clz32, (4 := float16));', 'TypeError');
  expectThrownKind('const via = (f, ...xs) => f(...xs); via(Math.min, (4 := uint8), (4 := uint16));', 'TypeError');
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
 * CLOSED. The ten functions this file used to pin as ABSENT are implemented, and
 * the pin has become its own opposite: the matrix now asserts they exist, and
 * named-arithmetic.test.mts covers their behaviour.
 *
 * Keeping the existence check here rather than deleting it is the point of the
 * original pin. These were specified from the start, with a normative table and a
 * worked note, and were missing for as long as the suite had no test that would
 * notice. An existence assertion is cheap and it is what turns "nobody wrote a
 * test for that" from a silent condition into a failing one.
 */
test('numeric library matrix: the named arithmetic forms exist and are integer-typed', () => {
  const NAMED_FORMS = [
    'addChecked', 'subChecked', 'mulChecked', 'divChecked',
    'addSaturating', 'subSaturating', 'mulSaturating', 'divSaturating',
    'divFloor', 'mod',
  ];
  for (const fn of NAMED_FORMS) {
    expect(evaluated(`String(typeof Math.${fn});`), `Math.${fn}`).toBe('function');
    // each is overloaded for every integer type and returns its operands' type
    for (const t of INTEGER_TYPES) {
      expect(evaluated(`(Math.${fn}((4 := ${t}), (2 := ${t})) is ${t}) ? "yes" : "no";`), `${fn} at ${t}`).toBe('yes');
    }
    // and for no other family, which is why they exist at all
    for (const t of FLOAT_TYPES) {
      expectThrownKind(`Math.${fn}((4 := ${t}), (2 := ${t}));`, 'TypeError');
    }
  }
});

// -- The bigint column, swept from the same table ------------------------------
test('numeric library matrix: the bigint column matches the listing', () => {
  // the rows the listing gives bigint, and the shape of each
  const BIGINT_ROWS: Record<string, 'value' | 'identity' | 'root' | 'none'> = {
    abs: 'value', sign: 'value', min: 'value', max: 'value', pow: 'value',
    floor: 'identity', ceil: 'identity', round: 'identity', trunc: 'identity',
    sqrt: 'root', cbrt: 'root',
  };
  for (const row of ROWS) {
    const shape = BIGINT_ROWS[row.fn] ?? 'none';
    const args = Array.from({ length: row.arity }, () => '8n').join(', ');
    if (shape === 'none') {
      expectThrownKind(`Math.${row.fn}(${args});`, 'TypeError');
    } else {
      // every bigint row answers with a bigint, exact and unbounded
      expect(evaluated(`String(typeof Math.${row.fn}(${args}));`), `${row.fn} at bigint`).toBe('bigint');
    }
  }
  // and the identity rows really are the identity
  for (const fn of ['floor', 'ceil', 'round', 'trunc']) {
    expect(evaluated(`String(Math.${fn}(8n) === 8n);`)).toBe('true');
  }
});

/**
 * GAP PINS for the operations a spec-coverage inventory finds specified and
 * absent. Each is a DELIBERATE deferral, verified against the clause and the
 * subsystem it belongs to, and pinned so that the next inventory pass does not
 * rediscover it as a possible oversight, and so that implementing one fails here
 * and prompts moving it into real coverage.
 *
 * The precedent for taking this seriously is that `Math.divFloor` looked exactly
 * as deferred as these and was not: it was simply missing, along with the eight
 * checked and saturating forms, and nothing noticed for as long as no test
 * mentioned them.
 */
test('a function with no numeric parameter is NOT overloaded, and untyped code is unchanged', () => {
  // The clause overloads functions that TAKE a value of a numeric type: an
  // argument's type selects the signature, so a call written without one is
  // unchanged. A function that merely RETURNS a number has nothing to select
  // on, and typing its result would change what every existing call returns
  // (F64). This was carried as work for many cycles - "apply the rules to
  // charCodeAt, indexOf, the Date getters" - and applying them is not
  // mechanical but forbidden.
  expect(evaluated('String("A".charCodeAt(0) === 65);')).toBe('true');
  expect(evaluated('String("abc".indexOf("b") === 1);')).toBe('true');
  expect(evaluated('String("abc".lastIndexOf("b") === 1);')).toBe('true');
  expect(evaluated('String(new Date(0).getFullYear() === 1970);')).toBe('true');
  // The reason those matter: a typed value and a plain Number are NOT equal,
  // so a typed result would silently break every one of these comparisons.
  expect(evaluated('String((65 := uint16) === 65);')).toBe('false');
  // parseInt and parseFloat are excluded by the same rule, and by name.
  expect(evaluated('String(parseInt("42px") === 42) + "/" + String(parseFloat("1.5x") === 1.5);')).toBe('true/true');
  // What IS overloaded dispatches on an argument: Math's rows, and an array's
  // length, which is typed only for a TYPED array.
  expect(evaluated('String(Math.abs((5 := int32)) is int32);')).toBe('true');
  expect(evaluated('let a: [].<uint8> = [1]; const b = [1]; String(a.length is uint32) + "/" + String(b.length is uint32);')).toBe('true/false');
});

test('inventory: the specified-but-absent operations are the deferrals they should be', () => {
  const DEFERRED: Record<string, string> = {
    // The complex value level is deferred entire: `complex` is not yet a usable
    // type, so its Math additions have nothing to operate on.
    'Math.conj': 'complex extension, value level deferred',
    'Math.arg': 'complex extension, value level deferred',
    // Recorded in the decorators sequence: the reflection surface lands before
    // the syntax gate, and the by-index form is a step of it.
    'Reflect.getReflectionByIndex': 'decorators, reflection surface step 2',
    // Structural matching. The clause itself calls it optional rather than
    // load-bearing: "the design's own catalog needed this operation exactly zero
    // times, which is the measurement that makes it optional".
    'Reflect.inferSlot': 'typeprogramming, structural matching',
    'Reflect.matchType': 'typeprogramming, structural matching',
  };
  for (const [name, why] of Object.entries(DEFERRED)) {
    expect(evaluated(`String(typeof ${name});`), `${name} is deferred: ${why}. If this now exists, move it into real coverage.`).toBe('undefined');
  }
});

/**
 * CLOSED. Provenance is implemented as a HOST-FACING channel (TypeOrigins,
 * exported from the engine, covered in provenance.test.mts). The half that stays
 * absent by design is the reflected `origin` property: the specification was
 * changed to make the channel host-facing, because origins union across
 * structurally identical declarations and a program reading one would see its own
 * type change when a stranger declared the same shape.
 */
test('inventory: provenance is a host channel and not a program-visible property', () => {
  expect(evaluated('let r = Reflect.getReflection(type uint8); String("origin" in r);')).toBe('false');
  expect(evaluated('String(typeof Reflect.getOrigin);')).toBe('undefined');
  // the expansion artifact of the same clause group is still absent
  expect(evaluated('String(typeof Reflect.expansionArtifact);')).toBe('undefined');
});
