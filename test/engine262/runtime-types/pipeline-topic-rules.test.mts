import { expect, test } from 'vitest';
import { expectThrown, ok } from './harness.mts';

/**
 * The topic has a type inside a pipeline body, and the WALK has to bind it as
 * `staticType` does.
 *
 * `staticType` had the binding, so the body was typed correctly - `let s: string
 * = n |> % + 1` was refused all along. But the judgments that REPORT live in the
 * walk, which descended into the body generically, with no topic in scope: every
 * rule that reads a type went silent there, and `n |> %()` reached the run
 * time's "% is not a function" though `n()` for the same binding is refused.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a walk rule reaches inside a pipeline body', () => {
  expectThrown(dead('let n: uint8 = uint8(1); let q = n |> %();'), 'is not callable');
  expectThrown(dead('let s: string = "x"; let q = s |> %();'), 'is not callable');
  expectThrown(dead('let n: uint8 = uint8(1); let q = n |> new %();'), 'is not a constructor');
});

test('what staticType already answered, unchanged', () => {
  expectThrown(dead('let n: uint8 = uint8(1); let s: string = n |> %;'), 'not assignable');
  expectThrown(dead('let n: uint8 = uint8(1); let s: string = n |> % + 1;'), 'not assignable');
  expectThrown(dead('let o: { a: uint8 } = { a: uint8(1) }; let s: string = o |> %.a;'),
    'not assignable');
});

test('ordinary pipelines are untouched', () => {
  expect(ok(dead('let q = 5 |> % + 1;'))).toBe(true);
  expect(ok(dead('let q = [1, 2, 3] |> %.length;'))).toBe(true);
  expect(ok(dead('let f: () => uint8 = () => uint8(1); let q = f |> %();'))).toBe(true);
  expect(ok(dead('let n: uint8 = uint8(1); let m: uint8 = n |> %;'))).toBe(true);
  // A topic reading a member the type does not declare stays ordinary, which is
  // the read asymmetry #sec-typed-storage settles rather than a rule this
  // reaches.
  expect(ok(dead('let o: { a: uint8 } = { a: uint8(1) }; let q = o |> %.zz;'))).toBe(true);
});
