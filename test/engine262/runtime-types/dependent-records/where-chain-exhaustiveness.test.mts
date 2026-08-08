import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-discriminated-where-chains section 3: the feature the plan exists for.
 *
 * dependentrecordtypes.md: pattern matching "checks a `match` over an `Address`
 * exhaustive from one arm per country with no `default`, and adding `'MX'` to
 * `country` becomes a compile-time error at every such `match` instead of
 * silently routing through a default clause."
 */

function outcome(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const c = realm.evaluateScriptSkipDebugger(
    `try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`,
  ) as { Value?: { stringValue?(): string } };
  return c.Value?.stringValue?.() ?? '?';
}

const AD = "type Ad = { s: string, c: 'US'|'CA' } "
  + "where if (this.c == 'US') { this is { p: string } } else { this is { p: string } }; ";
const VAL = "f({ s: 'x', c: 'US', p: 'M' });";

test('a qualifying chain makes a match EXHAUSTIVE without a default', () => {
  expect(outcome(`${AD}function f(a: Ad) { return match (a) { when { c: 'US' }: 1; when { c: 'CA' }: 2; }; } ${VAL}`))
    .toBe('ACCEPTED');
});

test('a MISSING arm is refused', () => {
  // The whole point: this compiled before, and silently.
  expect(outcome(`${AD}function f(a: Ad) { return match (a) { when { c: 'US' }: 1; }; } ${VAL}`))
    .toBe('TypeError');
});

test('a default still satisfies it', () => {
  expect(outcome(`${AD}function f(a: Ad) { return match (a) { when { c: 'US' }: 1; default: 0; }; } ${VAL}`))
    .toBe('ACCEPTED');
});

test('a GUARDED arm proves nothing', () => {
  // Same rule as over an enum, and for the same reason: the checker does not
  // evaluate guards, so a guarded clause carries no coverage however exhaustive
  // its pattern looks.
  expect(outcome(`${AD}function f(a: Ad) { return match (a) { when { c: 'US' }: 1; when { c: 'CA' } if (true): 2; }; } ${VAL}`))
    .toBe('TypeError');
});

test('adding a constant breaks every such match - the stated payoff', () => {
  // "adding `'MX'` to `country` becomes a compile-time error at every such
  // `match`". A two-arm match that was exhaustive stops being so.
  const AD3 = "type Ad3 = { s: string, c: 'US'|'CA'|'MX' } "
    + "where if (this.c == 'US') { this is { p: string } } else { this is { p: string } }; ";
  expect(outcome(`${AD3}function f(a: Ad3) { return match (a) { when { c: 'US' }: 1; when { c: 'CA' }: 2; }; } f({ s: 'x', c: 'US', p: 'M' });`))
    .toBe('TypeError');
  expect(outcome(`${AD3}function f(a: Ad3) { return match (a) { when { c: 'US' }: 1; when { c: 'CA' }: 2; when { c: 'MX' }: 3; }; } f({ s: 'x', c: 'US', p: 'M' });`))
    .toBe('ACCEPTED');
});

test('a NON-qualifying chain requires a default, as before', () => {
  // "A chain that does not qualify ... denotes nothing but itself and its
  // `match` writes a `default`."
  // NOTE the argument: a plain `1` is not a `uint8` at runtime, so an invalid
  // call raises a TypeError of its own and would read as an exhaustiveness
  // failure. Measured earlier in this project and easy to re-trip.
  const ORD = "type Ord = { n: string } where if (this.n > 'a') { this is { p: string } } else { this is { p: string } }; ";
  expect(outcome(`${ORD}function f(a: Ord) { return match (a) { when { n: 'b' }: 1; }; } f({ n: 'b', p: 'x' });`))
    .toBe('ACCEPTED');
});

test('the two pre-existing sources still work, through the same operation', () => {
  // Both now source their atoms from `Atoms`, so these are the regression
  // surface for the refactor as well as their own check.
  const E = 'enum E { A, B } ';
  expect(outcome(`${E}function f(e: E) { return match (e) { when E.A: 1; }; } f(E.A);`)).toBe('TypeError');
  expect(outcome(`${E}function f(e: E) { return match (e) { when E.A: 1; when E.B: 2; }; } f(E.A);`)).toBe('ACCEPTED');
  const S = 'sealed class S {} class T extends S {} class U extends S {} ';
  expect(outcome(`${S}function f(s: S) { return match (s) { when T: 1; }; } f(new T());`)).toBe('TypeError');
  expect(outcome(`${S}function f(s: S) { return match (s) { when T: 1; when U: 2; }; } f(new T());`)).toBe('ACCEPTED');
});
