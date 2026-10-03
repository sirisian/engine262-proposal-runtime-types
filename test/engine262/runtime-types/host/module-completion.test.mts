import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, type PromiseObject } from '#self';

test.each([
  { name: 'synchronous success', source: 'void 0;', completionType: 'normal', state: 'fulfilled' },
  { name: 'synchronous rejection', source: 'throw new Error("runtime");', completionType: 'normal', state: 'rejected' },
  { name: 'own-await success', source: 'await 0;', completionType: 'normal', state: 'fulfilled' },
  { name: 'own-await rejection before suspension', source: 'if (false) { await 0; } throw new Error("runtime");', completionType: 'throw' },
])('preserves the existing callback path for $name', ({ source, completionType, state }) => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const callbacks: unknown[] = [];
  realm.evaluateModule(source, undefined, (value) => {
    const completion = EnsureCompletion(value);
    callbacks.push(completion);
    expect(completion.Type).toBe(completionType);
    if (completion.Type === 'normal') expect((completion.Value as PromiseObject).PromiseState).toBe(state);
  });
  expect(callbacks).toHaveLength(1);
});

test.each(['await 0;', 'await 0; type Invalid = float32.<{ unknownKey: 1 }>;'])('repeated evaluation preserves the same settled module record: %s', (source) => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const parsed = realm.compileModule(source);
  if (parsed.Type !== 'normal') throw new Error('fixture did not parse');
  let bodyEntries = 0;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node === parsed.Value.ECMAScriptCode.ModuleBody) bodyEntries++;
  };
  const outcomes: unknown[] = [];
  for (let i = 0; i < 2; i++) {
    realm.evaluateModule(parsed.Value, undefined, (value) => {
      const completion = EnsureCompletion(value);
      outcomes.push(completion.Type === 'normal' ? (completion.Value as PromiseObject).PromiseResult : completion.Value);
      if (completion.Type === 'normal') expect((completion.Value as PromiseObject).PromiseState).toBe('fulfilled');
      else expect(completion.Type).toBe('throw');
    });
  }
  expect(outcomes).toHaveLength(2);
  if (source.includes('Invalid')) expect(outcomes[1]).toBe(outcomes[0]);
  expect(bodyEntries).toBe(source.includes('Invalid') ? 0 : 1);
});
