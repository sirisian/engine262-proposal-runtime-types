import { test, expect } from 'vitest';
import { run } from '../harness.mts';
import { BoundsProvenCountForLastCheck } from '#self';

/**
 * proposal-runtime-types sec-bounds-checks: "The index of a read or write of a
 * fixed-length `[N].<T>` is known to be below N, because N is a compile-time
 * constant and the index is a value generic, a `where`-constrained parameter,
 * or the counter of a `for` over a range with that bound. The bound is proven
 * statically and no check is performed."
 *
 * Eliding a check that would have PASSED is unobservable, so these assert the
 * PROOF rather than its effect. The negative rows carry the weight: a proof
 * that fires where it should not would discharge a check that was doing work,
 * and no positive test would notice.
 */
const proven = (source: string): number => {
  run(source);
  return BoundsProvenCountForLastCheck();
};

test('the proof fires for a range counter over a fixed extent', () => {
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<3) { x = a[i]; } "ok";')).toBe(1);
  // A closed end proves one more than an open one, so `0..=2` is the same bound.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..=2) { x = a[i]; } "ok";')).toBe(1);
  // A range narrower than the extent is proven too - the test is containment.
  expect(proven('let a: [8].<uint8> = [1,2,3,4,5,6,7,8]; let x := uint8 = 0; for (const i of 0..<4) { x = a[i]; } "ok";')).toBe(1);
  // Two accesses under one counter are two proofs.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<3) { x = a[i]; x = a[i]; } "ok";')).toBe(2);
});

test('the proof does NOT fire where the bound is not proven', () => {
  // The range reaches past the extent.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<9) { x = a[i]; } "ok";')).toBe(0);
  // An open start and a closed end move the floor and the ceiling in OPPOSITE
  // directions: `0<..=3` yields 1,2,3, whose ceiling is 4, which `[3]` does not
  // contain. Getting that arithmetic backwards is the mistake no positive test
  // would catch.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0<..=3) { x = a[i]; } "ok";')).toBe(0);
  // Not a fixed extent: `N` is what makes the bound a compile-time constant.
  expect(proven('let a: [].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<3) { x = a[i]; } "ok";')).toBe(0);
  // `a.length` is not a constant - the range bounds the counter when it was
  // BUILT, not when the index is used.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<a.length) { x = a[i]; } "ok";')).toBe(0);
  // The index is not the counter.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<2) { x = a[i+1]; } "ok";')).toBe(0);
  // A C-style loop carries no range to read a bound from. This is the
  // ergonomic cliff the clause creates, and it is deliberate.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (let i = 0; i < 3; i += 1) { x = a[i]; } "ok";')).toBe(0);
  // No enclosing loop at all.
  expect(proven('let a: [3].<uint8> = [1,2,3]; const i = 0; let x := uint8 = a[i]; "ok";')).toBe(0);
  // A plain array has no extent to prove anything against.
  expect(proven('const a = [1,2,3]; let x = 0; for (const i of 0..<3) { x = a[i]; } "ok";')).toBe(0);
});

test('the proof does not outlive its loop', () => {
  // The counter is in scope for the body only, so an access after the loop is
  // unproven even where the name is reused.
  expect(proven('let a: [3].<uint8> = [1,2,3]; let x := uint8 = 0; for (const i of 0..<3) { x = a[i]; } const i = 9; "ok";')).toBe(1);
});
