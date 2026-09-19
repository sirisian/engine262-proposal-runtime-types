import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * An exported `reservedOnlyDecorators` refused every decorator that was not one
 * of the seven reserved layout controls, on the ground that "under
 * `runtime-types` the ONLY decorators this engine implements are the reserved
 * layout controls ... Refusing is the honest state: a declaration that is
 * accepted and does nothing reads as support".
 *
 * That was true when written and had been overtaken: nothing called it, and the
 * engine runs base-language decorators with full semantics. Nothing in this
 * proposal asks for them to be refused either - #sec-replacement-decorators
 * defines the PREPROCESSOR decorator, whose name a `with { preprocessor:
 * "true" }` import introduces, and says nothing of the rest.
 *
 * These pin what the deleted function claimed was impossible, so the claim
 * cannot come back without a red test.
 */

test('a class decorator runs and its return replaces the class', () => {
  expect(evaluated('function foo(t, c) { return function Replaced() {}; } @foo class A {} A.name;'))
    .toBe('Replaced');
});

test('a class decorator runs for its effects', () => {
  expect(evaluated("let seen = 'no'; function foo(t, c) { seen = 'yes'; return t; } @foo class A {} seen;"))
    .toBe('yes');
});

test('the reserved layout controls still work beside them', () => {
  // The seven are read syntactically and are not base-language decorators; both
  // spellings coexist, which is what made the blanket refusal look plausible.
  expect(evaluated("class A { @align(4) x: uint8 = 0; } 'ok';")).toBe('ok');
});
