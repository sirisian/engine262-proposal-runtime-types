import { expect, test } from 'vitest';
import { Agent, EnsureCompletion, ManagedRealm, setSurroundingAgent } from '#self';
import { expectEarlyError, evaluated } from '../harness.mts';

/**
 * Round 4, Q6: a parser early error is kept as a pending record and its
 * error object is created when the early errors are collected, under the
 * agent that parses the source. A parse-only caller with no agent used to
 * crash on `Throw.SyntaxError` the moment any early error fired.
 */

test('an early error reported under an agent is unchanged', () => {
  expectEarlyError('class C { constructor<uint8>() {} }', 'SyntaxError');
  expectEarlyError('function f<T: type, T: type>() {}', 'SyntaxError');
  expect(evaluated('class C { operator +(o: C): C { return this; } } "ok";')).toBe('ok');
});

test('a parse with early errors under an agent realises each once, with its location', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger('class C { constructor<uint8>() {} constructor<T: type>() {} }'));
  expect(completion.Type).toBe('throw');
});
