import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

interface Fixture { id: string; source: string; uncheckedSource: string; expected: 'accept' | 'reject'; rules: string[] }
const corpus = JSON.parse(readFileSync(new URL('../conformance/boolean-flow.json', import.meta.url), 'utf8')) as { cases: Fixture[] };

function check(source: string, enabled = true) {
  const agent = new Agent({ features: enabled ? ['runtime-types'] : [] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let bodyRan = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyRan = true;
  };
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  return { completion, bodyRan, diagnostic: TypeDiagnosticOf(completion.Value) };
}

test.each(corpus.cases)('$id follows the independent Boolean transfer model', (fixture) => {
  const result = check(fixture.source);
  expect(result.completion.Type).toBe(fixture.expected === 'reject' ? 'throw' : 'normal');
  expect(result.bodyRan).toBe(fixture.expected === 'accept');
  if (fixture.expected === 'reject') {
    expect(result.diagnostic?.errorClass).toBe('StaticTypeError');
    expect(fixture.rules).toContain(result.diagnostic?.rule);
  }
});

test.each(corpus.cases)('$id preserves the unchecked JavaScript boundary', (fixture) => {
  for (const enabled of [false, true]) {
    const result = check(fixture.uncheckedSource, enabled);
    expect(result.completion.Type).toBe('normal');
    expect(result.bodyRan).toBe(true);
    expect(result.diagnostic).toBeUndefined();
  }
});
