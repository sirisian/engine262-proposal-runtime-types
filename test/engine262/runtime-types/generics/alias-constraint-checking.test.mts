import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';
import { Agent, ManagedRealm, EnsureCompletion, setSurroundingAgent } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-alias-outcomes.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source?: string; modules?: Record<string, string>; expected: Record<string, unknown> }[];
};

for (const { name, source, modules, expected } of corpus.cases) {
  test(name, async () => {
    const observation = modules ? await observeModuleGraph(modules) : (() => {
      const result = observeScript(source!);
      return { ...result, completion: result.completion.Type };
    })();
    expect(observation).toMatchObject(expected);
    if (!expected.diagnostic) expect(observation.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(observation.errorClass).toBeUndefined();
  });
}

test('verified alias predicates are not evaluated again by runtime annotation checks', () => {
  const source = 'type P<N: uint32> = uint32 where N > 0; '
    + 'function f(x: P.<3>): P.<3> { return x; } f(1); f(2); f(3);';
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let bodyEntered = false;
  let checked = 0;
  let repeated = 0;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
    if (node.type === 'RelationalExpression' && node.location.startIndex === source.indexOf('N > 0')) {
      if (bodyEntered) repeated++;
      else checked++;
    }
  };
  try {
    expect(EnsureCompletion(realm.evaluateScriptSkipDebugger(source)).Type).toBe('normal');
    expect(bodyEntered).toBe(true);
    expect(checked).toBeGreaterThan(0);
    expect(repeated).toBe(0);
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
});
