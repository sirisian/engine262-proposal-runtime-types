import { test, expect } from 'vitest';
import { kit, evaluateBuilder } from '../corpus/type-challenges/harness.mts';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-primitive-operator-blocks with #sec-type-errors.
 *
 * A bare value reaches a parameterization through a declared implicit cast, or
 * through the metadata's own admission - and WHICH applies is decided by running
 * hooks over the value, not by comparing types. `suffixed("Id")` admits
 * `"userId"` and refuses `"user"`: one type, two values, two answers. So there
 * is no type-level rule here, and a rule refusing every uncast crossing would
 * refuse programs the run time accepts.
 *
 * What IS decidable is a crossing whose source is a LITERAL, because the value
 * is in hand and the crossing can simply be run. It is run in the checking pass
 * rather than the walk, since only the pass has the `meta` declarations and the
 * implicit casts of the `primitive` blocks - which #sec-type-errors lists among
 * what it processes first.
 */

function run(program: string): string {
  const c = evaluateBuilder(kit(program)) as { completion: string, value?: unknown };
  return c.completion === 'normal' ? String(c.value) : 'refused';
}

test('a literal the metadata refuses is rejected before the source runs', () => {
  // The case that escaped: the binding is never reached, so nothing ran the
  // crossing and nothing was reported.
  expect(run("type T = suffixed('Id'); function f() { let v: T = 'user'; } 'declared';")).toBe('refused');
  expect(run("type T = prefixed('get'); function f() { let v: T = 'setName'; } 'declared';")).toBe('refused');
});

test('a literal the metadata admits still crosses', () => {
  expect(run("type T = suffixed('Id'); let v: T = 'userId'; String(v);")).toBe('userId');
  expect(run("type T = prefixed('get'); let v: T = 'getName'; String(v);")).toBe('getName');
  // Inside a function, where the crossing is now decided at check time: it must
  // be ADMITTED there too, not merely refused earlier.
  expect(run("type T = suffixed('Id'); function f() { let v: T = 'userId'; return v; } String(f());")).toBe('userId');
});

test('a live crossing keeps its behaviour', () => {
  // Refused before and refused now - what changed is only when, and only for
  // the cases the walk never reached.
  expect(run("type T = suffixed('Id'); let v: T = 'user'; String(v);")).toBe('refused');
  expect(run("type T = suffixed('.js'); let v: T = 'a.js'; String(v);")).toBe('a.js');
});

const DIM = "type Dim = { m?: number }; meta Dim { default = {}; subtype(a, b) { return true; } } ";
const CAST = "primitive float64 { operator float64.<{ m: 1 }>(): float64.<{ m: 1 }> { return this; } } ";
const V = "type Velocity = float64.<{ m: 1 }>; ";

/**
 * A parameterized NUMERIC is the one case decided from the types alone, and
 * #sec-literal-propagation says so where the rest of this rule does not:
 *
 *   "Nor does it reach a PARAMETERIZED numeric, which is unreachable by a bare
 *   literal and reachable through an implicit cast the program declares - so
 *   `uint32.<{ bounds: 5..=5 }>` refuses `5` until such an operator is written,
 *   and admits it once one is."
 *
 * So whether an operator was WRITTEN decides it, not what the metadata admits
 * of the value. Running the crossing answers the wrong question here: a
 * `subtype` hook that admits everything lets the literal through, and the
 * refusal then arrives when the binding runs.
 */

test('a bare literal at a parameterized numeric is refused until a cast is written', () => {
  expectStaticTypeError(`${DIM}${V}const v: Velocity = 10;`);
  // The positions that never run, which is what the move is for.
  expectStaticTypeError(`${DIM}${V}function f() { const v: Velocity = 10; }`);
  expectStaticTypeError(`${DIM}${V}function f(): Velocity { return 10; }`);
  expectStaticTypeError(`${DIM}${V}function g(v: Velocity) {} function f() { g(10); }`);
});

test('and admitted once one is', () => {
  expect(evaluated(`${DIM}${CAST}${V}const v: Velocity = 10; String(Number(v));`)).toBe('10');
  expect(evaluated(`${DIM}${CAST}${V}function g(v: Velocity) { return v; } String(Number(g(10)));`)).toBe('10');
  // The cast may be declared after the use: the pass processes the `primitive`
  // blocks before it judges, which #sec-type-errors requires of it.
  expect(ok(`${DIM}${V}function f() { const v: Velocity = 10; return v; } ${CAST}`)).toBe(true);
  // A default still crosses by the base's zero, which is the other way through.
  expect(evaluated(`${DIM}${CAST}${V}let d: Velocity; String(Number(d));`)).toBe('0');
});

test('an unparameterized numeric position is untouched', () => {
  expect(evaluated('let a: uint8 = 5; String(a);')).toBe('5');
  expectStaticTypeError('let r: uint8 = 300;');
});
