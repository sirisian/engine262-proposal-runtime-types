import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, InspectPattern, DecidesInclusion,
} from '#self';

/**
 * R18's decision procedure, from #sec-metadata: "pattern pairs free of
 * backreferences and lookaround, within a fixed automaton size, get the exact
 * language-inclusion answer."
 *
 * L(a) subset-of L(b) is decided as emptiness of a x complement(b): b is
 * determinized, a stays an NFA, and the product is walked for a state accepting
 * in a and not in b - one such state is a string a admits and b does not.
 *
 * The alphabet is SYMBOLIC: classes stay as ranges, cut into disjoint intervals
 * covering both patterns. Expanding a class to its members would not survive
 * `[\s\S]` under a Unicode flag, which this design's own kit writes.
 *
 * Construction is a WHITELIST. A node it does not model yields *undefined*, and
 * the caller reads that as "no exact answer" rather than "false", so an
 * unmodelled form makes the judgment weak and never wrong - which the clause
 * already provides for, pairs beyond the bound getting "the syntactic one".
 */

function decide(a: string, b: string): boolean | undefined | string {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  void new ManagedRealm();
  const left = InspectPattern(a, '');
  const right = InspectPattern(b, '');
  if (left.outside || right.outside) {
    return `outside: ${left.outside ?? right.outside}`;
  }
  return DecidesInclusion({ source: a, flags: '', ast: left.ast },
    { source: b, flags: '', ast: right.ast });
}

test('a narrower language is included in a wider one, and not the reverse', () => {
  expect(decide('^a$', '^a|b$')).toBe(true);
  expect(decide('^a|b$', '^a$')).toBe(false);
  expect(decide('^a$', '^a+$')).toBe(true);
  expect(decide('^a+$', '^a$')).toBe(false);
});

test('a language includes itself', () => {
  expect(decide('^a$', '^a$')).toBe(true);
  expect(decide('^a+$', '^a+$')).toBe(true);
});

test('two spellings of one language include each other', () => {
  // This is the answer reflexivity cannot give, and the reason R18 exists.
  expect(decide('^(ab)+$', '^ab(ab)*$')).toBe(true);
  expect(decide('^ab(ab)*$', '^(ab)+$')).toBe(true);
});

test('a form the construction does not model gives no answer, not a wrong one', () => {
  // A counted quantifier needs the atom rebuilt per repetition, which this does
  // not do yet - so it is `undefined`, and a caller falls back.
  expect(decide('^a{2}$', '^a+$')).toBe(undefined);
});
