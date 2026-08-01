import { test, expect } from 'vitest';
import {
  Agent, DiscriminatingChainOf, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * PLAN-discriminated-where-chains stage A: `sec-discriminated-where-chains`
 * qualification.
 *
 * **Syntactic, by design.** The specification says why: "The qualification is
 * syntactic so that no predicate reasoning enters the checker; the alternative
 * was a prover with a budget, and no other rule here asks for one." So a shape
 * this does not recognise DISQUALIFIES rather than being reasoned about.
 *
 * It answers with CONSTANTS, not a type — building the denoted union is stage
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
      n.forEach(walk);
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
  // nest gives the same answer whatever the braces look like** — which is why
  // the missing sugar blocks nothing.
  expect(chain("type B = { c: 'A'|'B'|'C' } where if (this.c == 'A') { this is { p: string } } else { if (this.c == 'B') { this is { p: string } } else { this is { p: string } } };"))
    .toBe('conditional:c[A,B,else]');
});

test('the MATCH form qualifies, including an `or` of constants', () => {
  expect(chain("type C = { c: 'US'|'CA' } where match (this.c) { when 'US': this is { p: string }; when 'CA': this is { p: string }; };"))
    .toBe('match:c[US,CA]');
  // "where a branch tests several constants, one member per constant" — the
  // branch carries both, and stage B expands them.
  expect(chain("type H = { c: 'A'|'B'|'C' } where match (this.c) { when 'A' or 'B': this is { p: string }; when 'C': this is { p: string }; };"))
    .toBe('match:c[A|B,C]');
});

test('TOTALITY is not decided here, deliberately', () => {
  // A chain with no final `else` is total only if its conditions exhaust the
  // discriminant's declared TYPE — a question about the type, not the
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
  // "every clause is unguarded" — a guard is a refinement the checker would have
  // to reason about, which is the thing the syntactic rule avoids.
  expect(chain("type F = { c: 'A'|'B' } where match (this.c) { when 'A' if (true): this is { p: string }; when 'B': this is { p: string }; };"))
    .toBe('no');
  // "no two clauses name one constant".
  expect(chain("type G = { c: 'A'|'B' } where match (this.c) { when 'A': this is { p: string }; when 'A': this is { p: string }; };"))
    .toBe('no');
});
