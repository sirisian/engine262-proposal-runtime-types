import { expect, test } from 'vitest';
import { evaluated, runFlagOff } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

test('each realm owns an initialized Identity declaration', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const first = new ManagedRealm();
  const second = new ManagedRealm();
  const identities = [first, second].map((realm) => {
    const completion = realm.evaluateScriptSkipDebugger('Identity;') as { Type: string, Value: unknown };
    expect(completion.Type).toBe('normal');
    expect(typeof completion.Value).toBe('object');
    expect(realm.evaluateScriptSkipDebugger('let n: Identity.<uint8> = 1; n;')).toMatchObject({ Type: 'normal' });
    return completion.Value;
  });
  expect(identities[0]).not.toBe(identities[1]);
  expect(first.evaluateScriptSkipDebugger('n = 2; n;')).toMatchObject({ Type: 'normal' });
});

test('the Identity prelude leaves the lexical name available', () => {
  expect(evaluated('type Identity<T: type> = [].<T>; let a: Identity.<uint8> = [1]; String(a[0]);')).toBe('1');
  const completion = runFlagOff('typeof Identity;') as { Type: string, Value: { stringValue(): string } };
  expect(completion.Type).toBe('normal');
  expect(completion.Value.stringValue()).toBe('undefined');
});
