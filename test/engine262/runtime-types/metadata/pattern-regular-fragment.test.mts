import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, InspectPattern } from '#self';

/**
 * #sec-primitive-metadata, the tier test for R18's decision procedure: "pattern pairs free
 * of backreferences and lookaround, within a fixed automaton size, get the exact
 * language-inclusion answer, and pairs beyond the bound get the syntactic one.
 * The tier is decided by syntactic size and NEVER by remaining fuel, so the
 * judgment is identical on every host."
 *
 * That prohibition is what shapes this: an implementation deciding the tier by
 * how much budget was left would have two hosts disagreeing about whether one
 * pattern type is a subtype of another, which is a question about types rather
 * than about resources. So both answers here are computed from the pattern text
 * alone, before any automaton exists.
 *
 * Neither excluded form is regular under the construction the procedure uses: a
 * backreference is not regular at all, and lookaround is not regular under it.
 * The clause names both rather than leaving an implementation to decide.
 */

function inspect(source: string, flags = ''): { outside: string, size: number } {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  void new ManagedRealm();
  const report = InspectPattern(source, flags);
  return { outside: report.outside ?? 'in', size: report.size };
}

test('an ordinary pattern is in the fragment, and has a size', () => {
  for (const source of ['^a+$', '^a|b$', '^[a-z]+$', '^(ab)+$', '^a{2,4}$']) {
    const r = inspect(source);
    expect(`${source} ${r.outside}`).toBe(`${source} in`);
    expect(r.size).toBeGreaterThan(0);
  }
});

test('a backreference is outside it, in either spelling', () => {
  // AtomEscape :: DecimalEscape, and AtomEscape :: `k` GroupName. They are told
  // apart by `production`, not by which field is present, which is what a first
  // attempt keyed on and missed the numeric one.
  expect(inspect('^(a)\\1$').outside).toBe('a backreference');
  expect(inspect('^(?<x>a)\\k<x>$').outside).toBe('a backreference');
});

test('lookaround is outside it, in all four forms', () => {
  expect(inspect('^(?=a)a$').outside).toBe('lookaround');
  expect(inspect('^(?!b)a$').outside).toBe('lookaround');
  expect(inspect('^(?<=a)b$').outside).toBe('lookaround');
  expect(inspect('^(?<!a)b$').outside).toBe('lookaround');
});

test('the size is syntax, so it does not depend on the host', () => {
  // The same pattern measured twice in fresh agents gives the same number, which
  // is the property the tier rests on.
  expect(inspect('^(ab|cd)+$').size).toBe(inspect('^(ab|cd)+$').size);
  // And a larger pattern measures larger.
  expect(inspect('^(ab|cd)+$').size).toBeGreaterThan(inspect('^a$').size);
});
