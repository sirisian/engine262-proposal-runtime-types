import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';
import {
  Agent, DenotedUnionOf, DiscriminatingChainOf, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-discriminated-where-chains (Discriminated Where Chains) -
 * qualification, and the union a qualified chain denotes.
 *
 * **Syntactic, by design.** The specification says why: "The qualification is
 * syntactic so that no predicate reasoning enters the checker; the alternative
 * was a prover with a budget, and no other rule here asks for one." So a shape
 * this does not recognise DISQUALIFIES rather than being reasoned about.
 *
 * It answers with CONSTANTS, not a type - building the denoted union is stage
 * B's, and keeping them apart is what lets every form be tested without
 * constructing a type.
 */

function chain(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const script = new Parser({ source, specifier: 't' }).parseScript();
  let clause: unknown;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || clause) {
      return;
    }
    if (Array.isArray(n)) {
      (n as unknown[]).forEach(walk);
      return;
    }
    if ((n as { type?: string }).type === 'WhereClause') {
      clause = n;
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === 'location' || key === 'sourceText' || key === 'parent') {
        continue;
      }
      walk((n as Record<string, unknown>)[key]);
    }
  };
  walk(script);
  const found = clause ? DiscriminatingChainOf(clause as never) : undefined;
  return found
    ? `${found.form}:${found.discriminant}[${found.branches.map((b) => b.constants.join('|') || 'else').join(',')}]`
    : 'no';
}

test('the CONDITIONAL form qualifies, and a nest IS a chain', () => {
  expect(chain("type A = { c: 'US'|'CA' } where if (this.c == 'US') { this is { p: string } } else { this is { p: string } };"))
    .toBe('conditional:c[US,else]');
  // `else if` is absent sugar, so a multi-condition chain nests. **Reading the
  // nest gives the same answer whatever the braces look like** - which is why
  // the missing sugar blocks nothing.
  expect(chain("type B = { c: 'A'|'B'|'C' } where if (this.c == 'A') { this is { p: string } } else { if (this.c == 'B') { this is { p: string } } else { this is { p: string } } };"))
    .toBe('conditional:c[A,B,else]');
});

test('the MATCH form qualifies, including an `or` of constants', () => {
  expect(chain("type C = { c: 'US'|'CA' } where match (this.c) { when 'US': this is { p: string }; when 'CA': this is { p: string }; };"))
    .toBe('match:c[US,CA]');
  // "where a branch tests several constants, one member per constant" - the
  // branch carries both, and the denoted union expands them.
  expect(chain("type H = { c: 'A'|'B'|'C' } where match (this.c) { when 'A' or 'B': this is { p: string }; when 'C': this is { p: string }; };"))
    .toBe('match:c[A|B,C]');
});

test('TOTALITY is not decided here, deliberately', () => {
  // A chain with no final `else` is total only if its conditions exhaust the
  // discriminant's declared TYPE - a question about the type, not the
  // predicate's shape. Reporting the constants and leaving the comparison to the
  // caller is what keeps this operation syntactic.
  expect(chain("type I = { c: 'A'|'B' } where if (this.c == 'A') { this is { p: string } };"))
    .toBe('conditional:c[A]');
});

test('each disqualifier the specification names', () => {
  // An ordering condition: "a nullish or ordering condition".
  expect(chain('type D = { n: uint8 } where if (this.n > 1) { this is { p: string } } else { this is { p: string } };'))
    .toBe('no');
  // "conditions over two members".
  expect(chain("type E = { a: 'X'|'Y', b: 'P'|'Q' } where if (this.a == 'X') { this is { p: string } } else { if (this.b == 'P') { this is { p: string } } else { this is { p: string } } };"))
    .toBe('no');
  // "every clause is unguarded" - a guard is a refinement the checker would have
  // to reason about, which is the thing the syntactic rule avoids.
  expect(chain("type F = { c: 'A'|'B' } where match (this.c) { when 'A' if (true): this is { p: string }; when 'B': this is { p: string }; };"))
    .toBe('no');
  // "no two clauses name one constant".
  expect(chain("type G = { c: 'A'|'B' } where match (this.c) { when 'A': this is { p: string }; when 'A': this is { p: string }; };"))
    .toBe('no');
});

// --- The denoted union ----------------------------------------------------

const BASE = () => ({
  Kind: 'object',
  Properties: [
    { key: 's', type: { Kind: 'string' }, optional: false, readonly: false },
    { key: 'c', type: { Kind: 'any' }, optional: false, readonly: false },
  ],
  IndexSignatures: [],
});
const LIT = (k: string) => ({ Kind: 'literal', Value: k, Base: { Kind: 'string' } });

function denoted(source: string, allConstants: readonly string[]) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const script = new Parser({ source, specifier: 't' }).parseScript();
  let clause: Record<string, unknown> | undefined;
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object' || clause) {
      return;
    }
    if (Array.isArray(n)) {
      (n as unknown[]).forEach(walk);
      return;
    }
    if ((n as { type?: string }).type === 'WhereClause') {
      clause = n as Record<string, unknown>;
      return;
    }
    for (const key of Object.keys(n as object)) {
      if (key === 'location' || key === 'sourceText' || key === 'parent') {
        continue;
      }
      walk((n as Record<string, unknown>)[key]);
    }
  };
  walk(script);
  const chain = clause ? DiscriminatingChainOf(clause as never) : undefined;
  const union = chain
    ? DenotedUnionOf(chain, BASE() as never, allConstants as never, LIT as never) as unknown as {
      Members: { Properties: { key: string, type: { Kind: string, Value?: unknown } }[] }[],
    }
    : undefined;
  return union
    ? union.Members.map((m) => m.Properties.map((p) => `${p.key}=${p.type.Kind === 'literal' ? p.type.Value : p.type.Kind}`).join(' ')).join(' | ')
    : 'undefined';
}

test('a qualifying chain DENOTES one member per branch-constant', () => {
  // "each the type's base with the discriminant narrowed to the constant tested".
  expect(denoted("type A = { s: string, c: 'US'|'CA' } where if (this.c == 'US') { this is { p: string } } else { this is { p: string } };", ['US', 'CA']))
    .toBe('s=string c=US | s=string c=CA');
  expect(denoted("type B = { s: string, c: 'US'|'CA' } where match (this.c) { when 'US': this is { p: string }; when 'CA': this is { p: string }; };", ['US', 'CA']))
    .toBe('s=string c=US | s=string c=CA');
});

test('a terminal `else` covers the constants the others did not', () => {
  // The chain alone cannot say what `else` means, which is why the operation
  // takes the discriminant's DECLARED constants as well as the chain.
  expect(denoted("type C = { s: string, c: 'A'|'B'|'C' } where if (this.c == 'A') { this is { p: string } } else { this is { p: string } };", ['A', 'B', 'C']))
    .toBe('s=string c=A | s=string c=B | s=string c=C');
});

test('a NON-TOTAL chain denotes nothing', () => {
  // "a chain with no `else` over a type it does not exhaust ... denotes nothing
  // but itself". Totality is checked here because this is where both the tested
  // and the declared constants are in hand.
  expect(denoted("type D = { s: string, c: 'A'|'B' } where if (this.c == 'A') { this is { p: string } };", ['A', 'B']))
    .toBe('undefined');
});

test('the union is a CHECKING artifact and touches no identity', () => {
  // **The rule most easily broken quietly.** The specification: "the dependent
  // record type remains one ~parameterized~ Type Record, `Reflect.typeOf`
  // reports it, and assignability compares against it."
  //
  // `DenotedUnionOf` RETURNS a union and stores nothing, so a caller that
  // memoized it onto the record would be the way that rule gets broken. These
  // assert the observable half.
  const T = "type A = { s: string, c: 'US'|'CA' } where if (this.c == 'US') { this is { p: string } } else { this is { p: string } }; ";
  // **The union must not LEAK into identity.** If it did, the reported kind
  // would be `union`; it is `object`, and the type remains one record.
  expect(evaluated(`${T}const a: A = { s: 'x', c: 'US', p: 'M' }; `
    + 'String(Reflect.getReflection.<Reflect.Type>(Reflect.typeOf(a)).kind);')).toBe('object');
  // Assignability still compares against the declared type.
  expect(evaluated(`${T}const a: A = { s: 'x', c: 'US', p: 'M' }; String(a is A);`)).toBe('true');
  // NOT asserted: that `Reflect.typeOf(a) === (type A)`. It is *false*, because
  // `typeOf` of a VALUE reports its structural type rather than the binding's
  // declared one - pre-existing, independent of this work, and measured rather
  // than assumed after a first draft asserted it and failed.
});

// -- Exhaustiveness over a chain -------------------------------------------------

/**
 * Spec: #sec-discriminated-where-chains (Discriminated Where Chains) -
 * exhaustiveness over a chain. Design: dependentrecordtypes.md.
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
