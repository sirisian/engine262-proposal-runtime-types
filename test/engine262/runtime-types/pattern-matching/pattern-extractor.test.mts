import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-pattern-matching.md phase three: extractors and matchers.
 *
 * `sec-patternmatches`, the `MatchNamePattern ( MatchPatternList? )` steps. "The
 * typed protocol is a method, usually static, from the subject to a tuple or
 * `null`."
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
const SOME = 'const Some = { [Symbol.customMatcher](v) { return v > 0 ? [v] : null; } }; ';

test('an EXTRACTOR matches through its custom matcher', () => {
  expect(evaluated(`${SOME} String(5 is Some(_));`)).toBe('true');
  // The extracted elements match the sub-patterns POSITIONALLY.
  expect(evaluated(`${SOME} String(5 is Some(5));`)).toBe('true');
  expect(evaluated(`${SOME} String(5 is Some(6));`)).toBe('false');
  // "`null` is no match."
  expect(evaluated(`${SOME} String(-1 is Some(_));`)).toBe('false');
  // Sub-patterns compose as anywhere else.
  expect(evaluated(`${SOME} String(5 is Some(1..<10));`)).toBe('true');
  expect(evaluated(`${SOME} String(5 is Some(_ and not 6));`)).toBe('true');
});

test('a count mismatch FAILS LOUDLY rather than part-matching', () => {
  // "A runtime TypeError where the counts disagree, so an extractor reached
  // through `any` fails loudly rather than part-matching." A pattern language
  // that silently matched the prefix would make a matcher's arity change a
  // silent behaviour change in every use.
  expect(outcome(`${SOME} 5 is Some(_, _);`)).toBe('TypeError');
  expect(outcome(`${SOME} 5 is Some();`)).toBe('TypeError');
  // A head that is not an object, or has no matcher, is a TypeError too - the
  // extractor form REQUIRES the protocol rather than falling back to a test.
  expect(outcome('const N = {}; 5 is N(_);')).toBe('TypeError');
});

test('a TUPLE matcher without parentheses is refused', () => {
  // "A boolean matcher with parentheses, or a tuple matcher without them, is a
  // type error, so the two protocols cannot be confused silently." The tuple
  // half is checkable at run time, which is where this asserts it.
  expect(outcome('const T = { [Symbol.customMatcher](v) { return [v]; } }; 5 is T;')).toBe('TypeError');
});

test('`Composite` is the parenthesis-free membership form', () => {
  // The design's own example of a boolean matcher, and the reason
  // `Composite[%Symbol.customMatcher%]` exists at all.
  expect(evaluated('String(Composite({ x: 1 }) is Composite);')).toBe('true');
  expect(evaluated('String(Composite([1]) is Composite);')).toBe('true');
  expect(evaluated('String({} is Composite);')).toBe('false');
  expect(evaluated('String(1 is Composite);')).toBe('false');
  // Shaped composites satisfy the top composite type, which is "the type of
  // every composite".
  expect(evaluated('interface I { x: uint8 } String(Composite.<I>({ x: 1 }) is Composite);')).toBe('true');
});

test('IsOfType and IsSubtype now AGREE about composites', () => {
  // A gap this phase surfaced: `let c: Composite = Composite({x: 1})` was
  // accepted - the assignment goes through IsSubtype - while
  // `Composite({x: 1}) is Composite` answered *false*, because IsOfType had no
  // composite case. One relation said yes and the other no about the same pair.
  // Membership now routes through the value's RUNTIME type and IsSubtype, so
  // the covariance-in-the-shape judgment lives in one place.
  expect(outcome('let c: Composite = Composite({ x: 1 });')).toBe('ACCEPTED');
  expect(evaluated('String(Composite({ x: 1 }) is Composite);')).toBe('true');
});

test('PINNED: a bare name that is not a type is refused by the CHECKER', () => {
  // The spec dispatches a bare `MatchNamePattern` on what the name turns out to
  // hold - a Type Object tests membership, a range tests containment, a value
  // with a matcher tests through it, and "anything else is a constant compared
  // by SameValue". The runtime dispatch is written; it is unreachable for a
  // plain constant because the CHECKER rejects `5 is K` as "K is not a type"
  // before evaluation. Widening that is checker work and lands with phase five.
  expect(outcome('const K = 5; 5 is K;')).toBe('TypeError');
});
