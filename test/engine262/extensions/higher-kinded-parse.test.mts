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

/**
 * PLAN-higher-kinded-types-engine.md phase 3.
 *
 * The APPLICATION half works: `W.<T>` where `W` is a bound higher-kinded
 * parameter resolves the parameter to the declaration an application bound to
 * it and applies that, so `W.<X>` means what writing the bound declaration
 * applied to X means. An alias argument goes through InstantiateGenericAlias
 * and a class or interface through the ordinary argument attach.
 *
 * The VALIDATION half took two attempts. It was written into
 * TypeNodeToTypeRecord first, where a `const` annotation reaches it and a type
 * annotation does not - the two-resolver split this work has met repeatedly.
 * It lives in one shared helper now, called from both, because a rule enforced
 * in one resolver and not the other is a rule that holds in some positions.
 */

test('a bound higher-kinded parameter applies', () => {
  expect(ok('type Identity<T> = T; class C<W<_>> { v: W.<uint8>; }')).toBe(true);
  expect(ok('class C<W<_>> { v: W; }')).toBe(false);
});

test('an argument must be a generic declaration of matching arity', () => {
  const P = 'type Identity<T> = T; class One<T> {} class Box<W<_>> {} class Pair<W<_, _>> {} ';
  expect(ok(`${P}function f(x: Box.<Identity>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Box.<One>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Pair.<Map>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Box.<uint8>) {}`)).toBe(false);
  expect(ok(`${P}function f(x: Box.<Map>) {}`)).toBe(false);
});

test('the two failures carry different messages', () => {
  // The clause distinguishes them because they are different mistakes, and
  // "uint8 is not assignable to Box" - the generic diagnostic, which is what
  // the first attempt produced - is true and useless.
  const P = 'class Box<W<_>> {} ';
  const messageOf = (src: string) => {
    const completion = run(src);
    let message = '';
    const value = completion.Value as { properties?: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> };
    for (const [key, desc] of value.properties ?? []) {
      if (key.stringValue?.() === 'message') {
        message = desc.Value.stringValue();
      }
    }
    return message;
  };
  expect(messageOf(`${P}function f(x: Box.<uint8>) {}`)).toContain('not a generic declaration');
  // And a LIBRARY generic reports its arity rather than being mistaken for a
  // non-declaration: its record carries no declaration node to count, which is
  // what made `Map` report the wrong one of the two.
  expect(messageOf(`${P}function f(x: Box.<Map>) {}`)).toContain('takes');
  expect(messageOf(`${P}function f(x: Box.<Map>) {}`)).toContain('2');
});

/**
 * PLAN-higher-kinded-types-engine.md phase 4 — probed, and three of the four
 * clauses need work that is now located rather than guessed at.
 *
 * 1. FIXED. A kinded argument was resolved as a type, so it worked in a
 *    parameter annotation and failed in a `const` one. `function f(x: B.<Identity>) {}` is
 *    accepted; `const a: B.<Identity> = null` reports that Identity "is not a
 *    type" — which is true of a bare generic alias and beside the point, since
 *    a kinded position wants a DECLARATION.
 *
 *    The cause is ordering rather than a missing rule: TypeNodeToTypeRecord
 *    resolves every type argument before it knows the base, so it cannot ask
 *    whether the parameter at that position is kinded. Resolving the base
 *    first, or deferring a bare name until the parameter is known, is the
 *    change. This is the fourth time this feature has met the two-resolver
 *    split, and the first where the two paths differ in ORDER rather than in
 *    which rules they know.
 *
 * 2. ANSWERED, AND IT IS NOT THIS FEATURE'S. `where` does not parse for ANY
 *    declaration - the token appears nowhere in the parser - so the refusal was
 *    about the clause and not about the kinded parameter, which is what the
 *    question was for. sec-generic-where writes a `where` "with the
 *    WhereClauses of sec-where-clauses where sec-checked-contracts admits
 *    them", and checked contracts is a specified extension the engine has not
 *    implemented. A kinded constraint will work when `where` does, and needs
 *    nothing of its own beyond what phase 3 already resolves.
 *
 * 3. VARIANCE IS NOT ENFORCED, and the cause is now narrowed. It is not the
 *    comparison and not the arguments' distinctness: `Identity === Boxed` is
 *    *false*, so the two declarations denote different types, while
 *    `B.<Identity> === B.<Boxed>` is *true* - the applications intern to ONE
 *    type.
 *
 *    orderKey does include a nominal's arguments in its key, and CLASS
 *    arguments collide exactly as alias arguments do, so this is neither about
 *    aliases nor about the key's shape. What is left is that the arguments
 *    never reach the record. That is the same defect the generics work fixed
 *    for ordinary arguments in NewExpression and the annotation path, and the
 *    one HKT phase 0 fixed for Type Objects in expression position - a third
 *    site with the same shape, which is worth noticing as a pattern rather
 *    than a coincidence.
 */

test('a kinded argument works in a parameter annotation', () => {
  expect(ok('type Identity<T> = T; class B<W<_>> {} function f(x: B.<Identity>) {}')).toBe(true);
});

test('a bare generic declaration is not a type', () => {
  // Correct, and the reason 1 above is a positional problem rather than a
  // missing rule: `Identity` unapplied is a declaration, and a type position
  // should refuse it.
  expect(ok('type Identity<T> = T; const a: Identity = 1;')).toBe(false);
});

test('a kinded argument resolves in a const annotation', () => {
  // The positional gap: arguments were resolved as types before the base was
  // known, so a bare generic declaration - which is what a kinded position
  // wants - reported that it "is not a type".
  const P = 'type Identity<T> = T; class B<W<_>> {} ';
  expect(ok(`${P}const a: B.<Identity> = new B();`)).toBe(true);
  expect(ok(`${P}function f(x: B.<Identity>) {}`)).toBe(true);

  // And the refusals survive the fallback: it resolves a bare name to its
  // declaration, and the validation still refuses it where the parameter was
  // not kinded or the arity does not match.
  expect(ok(`${P}const a: B.<uint8> = new B();`)).toBe(false);
  expect(ok(`${P}const a: B.<Map> = new B();`)).toBe(false);
});
