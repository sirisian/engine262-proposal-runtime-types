import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { run } from '../harness.mts';

/**
 * `PLAN-checker-type-resolution.md stage C2`: the checker's `resolveType` and the
 * runtime's `TypeNodeToTypeRecord` must agree about what an annotation means.
 *
 * They are two resolvers for one grammar, and `resolveType`'s own comment states
 * the contract: it "mirrors TypeNodeToTypeRecord so the checker and the runtime
 * agree on what the annotation means". Three divergences have been found by
 * accident so far - the range row, `Token`, and every qualified name - and each
 * was invisible until something asked the checker what such an annotation meant.
 * A type the checker cannot read is not merely unchecked: it can never be elided
 * (#sec-check-elision reads a static type), so the run-time check is paid
 * forever, and an unresolved return silently satisfied any function type.
 *
 * This test walks EVERY member of `ParseNode.Type` so a kind cannot be added
 * without a decision about it, and pins the kinds that diverge today so that
 * closing one is visible rather than silent.
 */

/** A kind whose annotation the checker resolves, and one it does not. */
type Row = {
  kind: string,
  /** Declarations the type expression needs. */
  setup: string,
  /** The type expression, written as a program writes it. */
  ty: string,
  /**
   * A value that is NOT of that type, so a resolved annotation refuses it.
   *
   * It must have a STATIC type of its own. An object literal does not, so `({})`
   * is assignable everywhere and reports every kind as a gap - which is what it
   * did here before this note existed.
   */
  bad: string,
};

/**
 * One row per member of `ParseNode.Type`. The coverage test below fails if the
 * union gains a member this list does not name.
 */
const rows: readonly Row[] = [
  { kind: 'UnionType', setup: '', ty: 'number | string', bad: 'true' },
  {
    kind: 'IntersectionType',
    setup: 'interface IA { a: number; } interface IB { b: string; } ',
    ty: 'IA & IB',
    bad: '5',
  },
  { kind: 'SharedType', setup: '', ty: 'shared number', bad: '"nope"' },
  { kind: 'ReferenceType', setup: '', ty: 'ref number', bad: '"nope"' },
  { kind: 'KeyOfType', setup: 'interface IK { a: number; } ', ty: 'keyof IK', bad: '5' },
  { kind: 'IndexedAccessType', setup: 'interface IX { a: number; } ', ty: 'IX["a"]', bad: '"nope"' },
  { kind: 'PredefinedType', setup: '', ty: 'string', bad: '5' },
  { kind: 'LiteralType', setup: '', ty: '5', bad: '"nope"' },
  { kind: 'PatternType', setup: '', ty: '/[a-z]+/', bad: '5' },
  { kind: 'RangeType', setup: '', ty: '0..<10', bad: '"nope"' },
  { kind: 'TypeReference', setup: '', ty: 'Token', bad: '5' },
  { kind: 'ComputedType', setup: '', ty: 'Composite({ x: 1 })', bad: '5' },
  { kind: 'ArrayType', setup: '', ty: '[].<number>', bad: '"nope"' },
  { kind: 'TupleType', setup: '', ty: '[number, string]', bad: '5' },
  { kind: 'ObjectType', setup: '', ty: '{ a: number }', bad: '5' },
  { kind: 'ParenthesizedType', setup: '', ty: '(number)', bad: '"nope"' },
  { kind: 'FunctionType', setup: '', ty: '(a: number) => string', bad: '5' },
];

/**
 * Kinds the checker cannot resolve, and the reason it cannot.
 *
 * Three of the seven this test first reported are closed
 * (`PLAN-checker-type-resolution.md stage E`): `ReferenceType` is a structural
 * record, and `KeyOfType` and `IndexedAccessType` compute from resolved operands
 * through the SAME helpers the runtime uses.
 *
 * The remaining four are gaps of three different KINDS, which is the finding
 * that matters more than the count.
 *
 * `SharedType` and `PatternType` are resolvable - their records are trivial -
 * and were resolved, and reverted. Each exposed a judgment downstream that does
 * not match the runtime's: `let s: shared uint8 = 1;` became an early error,
 * because a numeric literal reaches `uint8` by CONVERSION rather than by
 * subtyping and the checker's conversion path does not look through the `shared`
 * marker, and `float32.<{ p: /^a/ }>` failed once a pattern reached a metadata
 * argument. Closing these is a change to those paths, not to the resolver: the
 * annotation is readable, and reading it is not by itself enough.
 *
 * `ComputedType` is different in kind rather than in difficulty. Resolving it
 * requires EVALUATING THE PROGRAM: `Composite({ x: 1 })` calls its callee. A
 * checker that runs before evaluation has no call to make, so this list can never
 * be emptied by better resolution.
 *
 * That matters beyond this test. `PLAN-checker-type-resolution.md` Q6/D3 gates
 * reporting an unresolvable annotation as a user error on this set being EMPTY,
 * and it cannot become empty - so that gate needs restating as "empty of kinds
 * decidable without evaluation" before stage E can proceed. An annotation naming
 * `typeof x` is valid, and the checker's inability to read it is a property of
 * when the checker runs, not a defect in the program.
 */
const KNOWN_CHECKER_GAPS = new Set([
  // `SharedType` was here, and is closed: resolving it once made
  // `let s: shared uint8 = 1;` an early error because the checker's CONVERSION
  // path did not look through the marker, so the annotation was left unreadable
  // instead. `literalFitsNumericType` now looks through it, and the annotation
  // is resolved and judged - `let s: shared uint8 = "x";` is refused.
  'PatternType',
  'ComputedType',
]);

/**
 * Whether the CHECKER resolved the annotation.
 *
 * The probe is a bad initializer inside a function that is never called. Where
 * the checker reads the annotation the mismatch is an early error and the script
 * does not run; where it cannot, there is nothing to judge and the body is never
 * reached, so the script completes. Nothing else distinguishes the two: a value
 * boundary would refuse the bad value either way, at run time, which is exactly
 * how these gaps stayed invisible.
 */
function checkerResolves(row: Row): boolean {
  const completion = run(`${row.setup}function neverCalled() { let v: ${row.ty} = ${row.bad}; } "ran";`) as { Type: string };
  return completion.Type === 'throw';
}

/** Whether the RUNTIME resolved it: the same annotation, evaluated. */
function runtimeResolves(row: Row): boolean {
  const completion = run(`${row.setup}let v: ${row.ty} = ${row.bad}; "ran";`) as { Type: string, Value?: { stringValue?(): string } };
  return completion.Type === 'throw';
}

test('the corpus covers every member of ParseNode.Type', () => {
  // Read the union from the source rather than restating it: a list here would
  // be a second copy, and a kind added to the parser without a row would go on
  // diverging unnoticed - the drift this whole test exists to end.
  const source = readFileSync(
    fileURLToPath(new URL('../../../../src/parser/ParseNode.mts', import.meta.url)),
    'utf8',
  );
  const start = source.indexOf('export type Type =');
  expect(start, 'ParseNode.Type union not found - has it been renamed?').toBeGreaterThan(-1);
  const union = source.slice(start, source.indexOf(';', start));
  const members = [...union.matchAll(/\|\s*([A-Za-z]+)/g)].map((m) => m[1]);
  expect(members.length).toBeGreaterThan(0);

  const covered = new Set(rows.map((r) => r.kind));
  const missing = members.filter((m) => !covered.has(m));
  expect(missing, `ParseNode.Type members with no row: ${missing.join(', ')}`).toEqual([]);
  const extra = [...covered].filter((k) => !members.includes(k));
  expect(extra, `rows naming something that is not a Type member: ${extra.join(', ')}`).toEqual([]);
});

test('every type-node kind parses and reaches at least one resolver', () => {
  // A row that resolves in NEITHER is a broken row, not a finding: the type
  // expression is probably misspelled for its kind, and it would then report a
  // gap that does not exist.
  for (const row of rows) {
    expect(
      runtimeResolves(row),
      `the runtime does not resolve ${row.kind} written as \`${row.ty}\` - check the row, not the engine`,
    ).toBe(true);
  }
});

test('the checker resolves every kind the runtime resolves, except the known gaps', () => {
  const diverged: string[] = [];
  for (const row of rows) {
    if (KNOWN_CHECKER_GAPS.has(row.kind)) {
      continue;
    }
    if (!checkerResolves(row)) {
      diverged.push(`${row.kind} (\`${row.ty}\`)`);
    }
  }
  expect(
    diverged,
    `the checker stopped resolving: ${diverged.join(', ')}. `
    + 'A kind the runtime reads and the checker does not is unchecked statically and '
    + 'unelidable; see PLAN-checker-type-resolution.md.',
  ).toEqual([]);
});

test('the known-gap list is not stale', () => {
  // A gap that has been closed must leave this list, or the list stops being a
  // record of work outstanding and becomes a place where a fixed kind hides.
  const closed: string[] = [];
  for (const row of rows) {
    if (KNOWN_CHECKER_GAPS.has(row.kind) && checkerResolves(row)) {
      closed.push(row.kind);
    }
  }
  expect(
    closed,
    `these kinds now resolve and must be removed from KNOWN_CHECKER_GAPS: ${closed.join(', ')}`,
  ).toEqual([]);
});
