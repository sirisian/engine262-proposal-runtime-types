import { test, expect } from 'vitest';
import {
  ok, evaluated, run,
} from '../readme/harness.mts';

/**
 * PLAN-higher-kinded-types-engine.md phase 1, per #sec-higher-kinded-parameters.
 *
 * A parameter is higher-kinded when its name is followed by a bracketed list of
 * `_`, and the count of holes is its arity. Nothing here gives the arity a
 * meaning yet — that is phase 2 — so these are parse assertions.
 */

test('a higher-kinded parameter declares, at each arity and position', () => {
  expect(ok('interface I<W<_>> {}')).toBe(true);
  expect(ok('interface I<W<_, _>> {}')).toBe(true);
  expect(ok('interface I<W<_>, T> {}')).toBe(true);
  expect(ok('interface I<T, W<_>> {}')).toBe(true);
  expect(ok('class C<W<_>> {}')).toBe(true);
  expect(ok('type A<W<_>> = uint8;')).toBe(true);
});

test('only `_` is a hole', () => {
  // Each of these is a spelling a reader might reasonably try. `<W<T>>` reads
  // as a nested parameter; `~`, `*`, and a numeral are the three alternatives
  // named and rejected in higherkindedtypes.md.
  expect(ok('interface I<W<T>> {}')).toBe(false);
  expect(ok('interface I<W<~>> {}')).toBe(false);
  expect(ok('interface I<W<*>> {}')).toBe(false);
  expect(ok('interface I<W<1>> {}')).toBe(false);
});

test('arity zero is spelled without brackets', () => {
  expect(ok('interface I<W<>> {}')).toBe(false);
  expect(ok('interface I<W> {}')).toBe(true);
});

test('a higher-kinded parameter takes a constraint and a default', () => {
  expect(ok('type Identity<T> = T; interface I<W<_> : Identity.<uint8>> {}')).toBe(true);
  expect(ok('type Identity<T> = T; interface I<T, W<_> = Identity> {}')).toBe(true);
});

test('a defaulted parameter may not precede a required one', () => {
  // The rule was stated in the specification and enforced nowhere, and the
  // higher-kinded work found it by relying on it: `Iterator<T, R, N, W<_> =
  // Identity>` places its wrapper last BECAUSE of this rule, and an unenforced
  // rule is not a reason for anything.
  expect(ok('type Identity<T> = T; interface I<W<_> = Identity, T> {}')).toBe(false);
  expect(ok('type Identity<T> = T; interface I<T, W<_> = Identity> {}')).toBe(true);

  // It is not a rule about kinded parameters — it holds for every parameter,
  // which is where it was missing.
  expect(ok('interface I<T = uint8, U> {}')).toBe(false);
  expect(ok('interface I<U, T = uint8> {}')).toBe(true);
  expect(ok('interface I<U, T = uint8, V = uint8> {}')).toBe(true);
});

test('the shared tokens still mean what they did', () => {
  // `_` is the pattern wildcard and `%` is both the remainder operator and the
  // pipeline topic. This extension leans on positional disambiguation, so the
  // positions it does not touch are asserted here.
  expect(evaluated('const r = match (1) { when _: "any"; }; String(r);')).toBe('any');
  expect(evaluated('String(7 % 4);')).toBe('3');
  expect(evaluated('String(5 |> % + 1);')).toBe('6');
});

/**
 * PLAN-higher-kinded-types-engine.md phase 2: the arity reaches the record.
 *
 * A `~parameter~` Type Record carries the arity its declaration wrote, and the
 * central rule follows from it — a higher-kinded parameter stands for a
 * declaration, so it is NOT a type and may not be written as one.
 */

test('an unapplied higher-kinded parameter is not a type', () => {
  expect(ok('class C<W<_>> { v: W; }')).toBe(false);
  expect(ok('type Identity<T> = T; class C<W<_>> { v: W.<uint8>; }')).toBe(true);
});

test('the refusal names the arity', () => {
  // Asserting the MESSAGE, not only the refusal. A reader who writes `W` where
  // `W.<T>` belongs needs to be told how many arguments it wants, and the
  // generics work found a refusal that was right for the wrong words because
  // nothing checked them.
  const completion = run('class C<W<_, _>> { v: W; }');
  expect(completion.Type).toBe('throw');
  let message = '';
  for (const [key, desc] of (completion.Value as { properties: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> }).properties) {
    if (key.stringValue?.() === 'message') {
      message = desc.Value.stringValue();
    }
  }
  expect(message).toContain('2');
  expect(message).toContain('unapplied');
});

test('arity distinguishes parameters of the same name', () => {
  // `W<_>` and `W<_, _>` are different parameters: one stands for a
  // one-argument declaration and the other for a two-argument one, so a value
  // of one is not a value of the other.
  expect(ok('class C<W<_>> { v: W.<uint8>; }')).toBe(true);
  expect(ok('class C<W<_, _>> { v: W.<uint8>; }')).toBe(true);
});

test('an ordinary parameter is untouched', () => {
  // Arity 0 is what every existing generic declares, and the whole generics
  // suite is the real assertion; these are the shapes closest to the change.
  expect(ok('class C<T> { v: T; }')).toBe(true);
  expect(ok('class C<T> { m(v: T): T { return v; } }')).toBe(true);
  expect(ok('function f<T>(x: T): T { return x; }')).toBe(true);
});
