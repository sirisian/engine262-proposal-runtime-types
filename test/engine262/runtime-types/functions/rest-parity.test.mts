// PLAN-variadic-and-named-generic-arguments.md Phase 0.6 (F-D, F-E): the
// README's own multi-rest examples, verbatim. These are the function-side
// parity anchors the generic pack rules mirror - `BindTypeArguments` shares
// `SequenceAssignment` with this path, so a rule that holds here is the rule
// packs inherit.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test('a typed rest splits from a fixed parameter with untyped literals (F0a, F-E)', () => {
  // Before: "no assignment of the arguments satisfies the parameter list" -
  // the distribution used IsOfType alone, so an untyped 0 was admitted nowhere.
  expect(evaluated('function f(...a: [].<uint32>, c: uint32) { return String(a.length) + "/" + String(c); } f(0, 1, 2);')).toBe('2/2');
});

test('two same-typed rests split greedily, the fixed tail satisfied (F0a, README example)', () => {
  expect(evaluated('function f(...a: [].<uint32>, ...b: [].<uint32>, c: uint32) { return String(a.length) + "/" + String(b.length) + "/" + String(c); } f(0, 1, 2);')).toBe('2/0/2');
});

test('the README multi-rest example splits by element type (F0c, F-E)', () => {
  expect(evaluated('function g(a: string, ...args: [].<uint32>, ...args2: [].<string>, cb: () => void) { return String(args.length) + "/" + String(args2.length); } g("a", 0, 1, 2, "a", "b", () => {});')).toBe('3/2');
});

test('a value the element type refuses still refuses after the literal rule (F-E boundary)', () => {
  expectThrown('function f(...a: [].<uint.<8>>, ...b: [].<string>) {} f(300, 300);');
});

test('two rests with nothing typed between them are an error (F0d, F-D)', () => {
  expectThrown('function f(...a, ...b) {}', 'nothing typed');
  expectThrown('function f(...a: [].<uint32>, ...b) {}', 'nothing typed');
  expectThrown('function f(...a, ...b: [].<uint32>) {}', 'nothing typed');
});

test('a typed parameter between untyped rests is a boundary, as the README states', () => {
  expect(evaluated('function f(...args1, callback1: () => void, ...args2, callback2: () => void) { return String(args1.length) + "/" + String(args2.length); } f("a", 1, 1.0, () => {}, "b", 2, 2.0, () => {});')).toBe('3/3');
});
