import { test, expect } from 'vitest';
import { ok, evaluated } from '../harness.mts';

/**
 * typeprogramming.md section 8 asked whether a meta type should be able to VETO a
 * structural edit - whether a builder should be stopped from stripping a mark
 * from a type whose users depend on it.
 *
 * It should not, because the edit is already an ordinary assignability question
 * and the metadata subtype judgment already answers it. A builder may strip the
 * mark; what it cannot do is make the result usable where the marked type is
 * required. A veto would be a second mechanism refusing what the first refuses,
 * and it would have to decide what a BUILDER may do rather than what a VALUE may
 * be - which is the distinction R1's identity law rests on.
 */

// A judgment that refuses to drop the mark: marked is usable where unmarked is
// wanted, never the reverse.
const META = 'type M = { b?: boolean }; meta M { default={}; subtype(a,b){ return b.b === undefined || a.b === b.b; } } ';
const MARKED = 'type Marked = float64.<{ b: true }>; ';
const STRIP = 'function strip(X: type): type { return Reflect.getReflection(X).base; } ';

test('a builder can strip a mark, and the result is a different type', () => {
  expect(evaluated(`${META}${MARKED}${STRIP} String(strip(Marked) === float64);`)).toBe('true');
  expect(evaluated(`${META}${MARKED}${STRIP} String(strip(Marked) === Marked);`)).toBe('false');
});

test('but the stripped type is not assignable back, so nothing is lost', () => {
  expect(evaluated(`${META}${MARKED} String(Reflect.isAssignable(Marked, float64));`)).toBe('true');
  expect(evaluated(`${META}${MARKED}${STRIP} String(Reflect.isAssignable(strip(Marked), Marked));`)).toBe('false');
});

test('and a function requiring the marked type refuses the stripped one', () => {
  expect(ok(`${META}${MARKED}${STRIP} function d(x: Marked): float64 { return 1; }`
    + ' let v: strip(Marked) = 5; d(v);')).toBe(false);
  // The same stripped binding is admitted where the BASE is required, so the
  // refusal above is about the mark and not the shape or the value.
  expect(ok(`${META}${MARKED}${STRIP} function e(x: float64): float64 { return 1; }`
    + ' let v: strip(Marked) = 5; e(v);')).toBe(true);
});
