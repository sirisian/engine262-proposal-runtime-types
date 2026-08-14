import { expect, test } from 'vitest';
import { evaluated, expectThrown } from './harness.mts';

/**
 * `match all (subject) { ... }` - every arm that matched, rather than the first.
 *
 * Three things differ from `match` and nothing else does. The value is a list in
 * arm order; exhaustiveness does not apply, because no arm need match and an
 * empty list is an answer rather than a missing case; and arm-failure
 * subtraction does not apply, because a later clause is reached whether or not
 * an earlier one matched.
 *
 * `default` is refused. It and `_` are synonyms in a `match`, and a word meaning
 * "always" in one form and "only if nothing else did" one form over is a trap.
 */

test('every matching arm contributes, in arm order', () => {
  expect(evaluated('const c = { hp: 10, mp: 5, inCombat: true };'
    + ' JSON.stringify(match all (c) { when { hp: 10 }: "H"; when { mp: 5 }: "M"; when { inCombat: true }: "C"; });'))
    .toBe('["H","M","C"]');
  // Only those that matched, and still in arm order rather than match order.
  expect(evaluated('const c = { hp: 10 };'
    + ' JSON.stringify(match all (c) { when { mp: 5 }: "M"; when { hp: 10 }: "H"; });'))
    .toBe('["H"]');
  // One arm gives a one-element list, not the bare value.
  expect(evaluated('JSON.stringify(match all (7) { when 7: "seven"; });')).toBe('["seven"]');
});

test('no arm matching is an answer, not a missing case', () => {
  // The case exhaustiveness would refuse in a `match`. Here it is an empty list.
  expect(evaluated('JSON.stringify(match all (99) { when 1: "a"; when 2: "b"; });')).toBe('[]');
  // And the same clauses under `match` throw, since nothing covers the subject.
  expectThrown('match (99) { when 1: "a"; when 2: "b"; };');
});

test('`when _` always contributes, alongside arms that also matched', () => {
  expect(evaluated('JSON.stringify(match all (7) { when 7: "seven"; when _: "any"; });'))
    .toBe('["seven","any"]');
});

test('`default` is refused, and the message names what to write instead', () => {
  // Refused rather than given a second meaning: `default` and `_` are synonyms
  // in a `match`, and the author who wrote `default` wanted a catch-all, which
  // `when _` is.
  expectThrown('match all (1) { when 1: "a"; default: "b"; };');
  expect(evaluated('JSON.stringify(match all (1) { when 1: "a"; when _: "b"; });')).toBe('["a","b"]');
});

test('guards run per arm and a false guard skips only that arm', () => {
  expect(evaluated('JSON.stringify(match all (7) { when _ if (7 > 5): "big"; when _ if (7 > 100): "huge"; when _: "any"; });'))
    .toBe('["big","any"]');
});

test('bindings are per arm and do not leak', () => {
  expect(evaluated('JSON.stringify(match all ({ a: 3 }) { when { let a }: a * 2; when { a: 3 }: "three"; });'))
    .toBe('[6,"three"]');
});

test('the subject is evaluated once, however many arms match', () => {
  expect(evaluated('let n = 0; const f = () => { n += 1; return 5; };'
    + ' match all (f()) { when 5: 1; when _: 2; when _: 3; }; String(n);')).toBe('1');
});

test('arm bodies run in source order', () => {
  // The observable that tells "every matching arm ran" apart from "every arm was
  // present": the effects happen, and they happen in the order written.
  expect(evaluated('const log = []; match all (1) { when _: log.push("a"); when _: log.push("b"); }; log.join(",");'))
    .toBe('a,b');
});

test('a throwing arm aborts, and the arms before it have already run', () => {
  expect(evaluated('const log = []; try { match all (1) {'
    + ' when _: log.push("a");'
    + ' when _: (() => { throw new Error("x"); })();'
    + ' when _: log.push("c"); } } catch (e) {} log.join(",");')).toBe('a');
});

test('a block arm carries its completion value', () => {
  expect(evaluated('JSON.stringify(match all (1) { when 1: { const x = 2; x * 3; } when _: "w"; });'))
    .toBe('[6,"w"]');
});

test('`match` and `all` are still ordinary identifiers', () => {
  // The contextual-keyword cases, which are what a mistake here breaks.
  expect(evaluated('const all = 3; String(all);')).toBe('3');
  expect(evaluated('const o = { all: 1 }; String(o.all);')).toBe('1');
  expect(evaluated('function all(x) { return x; } String(all(4));')).toBe('4');
  expect(evaluated('function match(x) { return x; } String(match(5));')).toBe('5');
  expect(evaluated('function match(x) { return x; } const all = 6; String(match(all));')).toBe('6');
});

test('a LineTerminator before `all` forbids the form', () => {
  // With the restriction this is `match;` and then `all(1) { ... }`, which is a
  // call followed by a block and so a Syntax Error - exactly as it is today.
  // WITHOUT the restriction it would parse as a `match all` whose subject sits
  // on the next line, which is the reading the restriction exists to refuse.
  const NL = String.fromCharCode(10);
  expectThrown(`function all(x) { return x; }${NL}match${NL}all(1) { when _: 2; }`);
  // On one line it is the form.
  expect(evaluated('JSON.stringify(match all (1) { when _: 2; });')).toBe('[2]');
  // And `match` alone on a line, followed by an ordinary call, still parses as
  // the two statements it is.
  expect(evaluated(`function match(x) { return x; } function all(x) { return x; }`
    + `${NL}match${NL}all(1);${NL}"ok";`)).toBe('ok');
});

test('a plain `match` is unchanged', () => {
  expect(evaluated('String(match (7) { when 7: "seven"; default: "other"; });')).toBe('seven');
  expect(evaluated('String(match (8) { when 7: "seven"; default: "other"; });')).toBe('other');
});

test('the forms nest in each other', () => {
  expect(evaluated('JSON.stringify(match all (2) { when 2: match (2) { when 2: "inner"; default: "no"; }; });'))
    .toBe('["inner"]');
  expect(evaluated('String(match (2) { when 2: JSON.stringify(match all (2) { when 2: "a"; when _: "b"; }); default: "no"; });'))
    .toBe('["a","b"]');
});
