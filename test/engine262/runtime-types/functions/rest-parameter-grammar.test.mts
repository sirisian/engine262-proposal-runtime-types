import { test, expect } from 'vitest';
import {
  evaluated, ok, expectErrorFlagOff, evaluatedFlagOff,
} from '../harness.mts';

/**
 * PLAN-rest-parameters.md phase 1: the parser.
 *
 * The design's rest parameters section (README) writes three things the grammar
 * did not admit: a rest carrying a type, a rest followed by further parameters,
 * and more than one rest in a list. #sec-type-annotations restates
 * BindingRestElement to carry a TypeAnnotation and FormalParameters so that a
 * rest is an ordinary element of the list.
 *
 * Nothing here BINDS arguments yet - which run each rest takes is
 * SequenceAssignment's, in phase 2, and the calls below are written so that the
 * assignment is unambiguous under any rule. What these pin is that the forms
 * PARSE, that they parse in every position a parameter list appears, and that
 * the base language is untouched with the feature off.
 */

test('a rest parameter carries a type', () => {
  expect(evaluated('function f(a: string, ...args: [].<uint32>) { return args.length; } String(f("a", 1, 2));')).toBe('2');
  // The same annotation in a destructuring rest, which reaches its binding
  // through the same production and so was equally unparseable.
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2, 3]; String(b.length);')).toBe('2');
});

test('a rest may be followed by further parameters', () => {
  expect(ok('function f(...a: [].<uint32>, b: string) { return b; }')).toBe(true);
  expect(ok('function f(a: uint8, ...b: [].<uint32>, c: string) { return c; }')).toBe(true);
});

/**
 * What phase 1 does NOT do, recorded so the boundary is visible.
 *
 * These forms PARSE now; they do not yet BIND. At run time a non-trailing rest
 * is still bound as though it were an ordinary positional parameter - for
 * `function f(...a: [].<uint32>, b: string)` called `f(1, 2, "x")`, `a` is the
 * number 1 and `b` is 2 - because FunctionDeclarationInstantiation consumes the
 * argument iterator in declaration order and a rest that is not last has no
 * meaning to it.
 *
 * PLAN-rest-parameters.md phase 4c is where that is settled, by running the
 * same SequenceAssignment over the runtime types. Asserting the current answer
 * here would pin a half-implemented state as a requirement, so it is written
 * down rather than tested.
 */

test('a parameter list may hold more than one rest', () => {
  // The design's own example, README "Rest Parameters".
  expect(ok('function f(a: string, ...args: [].<uint32>, ...args2: [].<string>, callback: () => void) {}')).toBe(true);
  // Its worked one, whose binding phase 2 settles.
  expect(ok('function f(...a: [].<uint32>, ...b: [].<uint32>, c: uint32): void {}')).toBe(true);
  // Untyped rests separated by typed parameters, also from that section. No
  // early error refuses these: under leftmost-greedy matching every list has a
  // determined assignment, so a list the design calls confusing is allowed and
  // discouraged rather than rejected.
  expect(ok('function f(...args1, callback1: () => void, ...args2, callback2: () => void) {}')).toBe(true);
});

test('every parameter position admits the new forms', () => {
  // A method, an accessor's owner, a class constructor, a generator, and an
  // async function all reach FormalParameters or UniqueFormalParameters, so a
  // regression in any of them would otherwise surface only in test262.
  expect(ok('class C { m(...a: [].<uint32>, b: string) { return b; } }')).toBe(true);
  expect(ok('class C { constructor(...a: [].<uint32>, b: string) {} }')).toBe(true);
  expect(ok('function* g(...a: [].<uint32>, b: string) { yield b; }')).toBe(true);
  expect(ok('async function h(...a: [].<uint32>, b: string) { return b; }')).toBe(true);
  expect(ok('const o = { m(...a: [].<uint32>, b: string) { return b; } };')).toBe(true);

  // Arrows come through the cover grammar and are refined afterwards, which is
  // a separate path. A TYPED rest never parsed there at any position before
  // this phase, so both halves are pinned.
  expect(ok('const g = (...a: [].<uint32>) => a.length;')).toBe(true);
  expect(ok('const g = (...a: [].<uint32>, b: string) => b;')).toBe(true);
  expect(ok('const g = (...a, b) => b;')).toBe(true);
});

test('a rest still may not carry an initializer', () => {
  // Unchanged from the base language, and the one early error the parser keeps.
  expect(ok('function f(...a = []) {}')).toBe(false);
});

test('the base language is untouched with the feature off', () => {
  // Everything the new grammar admits stays a Syntax Error without the feature,
  // which is what makes the change additive.
  expectErrorFlagOff('function f(...a, b) {}');
  expectErrorFlagOff('const g = (...a, b) => b;');
  expectErrorFlagOff('const g = (...a: uint8) => 1;');
  expectErrorFlagOff('function f(...a: [].<uint32>, ...b: [].<string>) {}');

  // And what the base language already accepted still runs, including a
  // call-site spread, which shares the `...` token and no longer shares a code
  // path with the parameter forms.
  expect(evaluatedFlagOff('function f(a, ...b) { return b.length; } String(f(1, 2, 3));')).toBe('2');
  expect(evaluatedFlagOff('const g = (...a) => a.length; String(g(1, 2));')).toBe('2');
  expect(evaluatedFlagOff('function f(a, b) { return a + b; } const xs = [1, 2]; String(f(...xs));')).toBe('3');
});

test('a call-site spread is unaffected by the parameter forms', () => {
  // `f(...xs)` and `function f(...xs: T)` share a token and nothing else; the
  // annotation is read in the parameter grammars, not in an argument list.
  expect(evaluated('function f(a: uint8, b: uint8) { return a + b; } const xs = [1, 2]; String(f(...xs));')).toBe('3');
});
