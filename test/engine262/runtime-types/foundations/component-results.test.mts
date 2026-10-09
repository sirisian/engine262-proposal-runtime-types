import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { InferenceLimits } from '../../../../src/type-system/inference-limits.mts';
import type { ScriptCheckingMode } from '../harness.mts';
import { Agent, ManagedRealm, TypeDiagnosticOf, EnsureCompletion, setSurroundingAgent, ObjectValue } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/component-results.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; checking: ScriptCheckingMode; budget: InferenceLimits; expected: Record<string, unknown> }[];
};

for (const { name, source, checking, budget, expected } of corpus.cases) {
  test(name, () => {
    const agent = new Agent({ features: checking === 'disabled' ? [] : ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm({ returnInferenceBudget: budget } as never);
    let bodyEntered = false;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') bodyEntered = true;
    };
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source, { forceCheckedCode: checking === 'forced' }));
    const diagnostic = TypeDiagnosticOf(result.Value);
    const errorClass = result.Type === 'throw' && result.Value instanceof ObjectValue
      && 'Prototype' in result.Value && result.Value.Prototype === realm.Intrinsics['%StaticTypeError.prototype%'] ? 'StaticTypeError' : undefined;
    expect({ completion: result.Type, bodyEntered, diagnostic, errorClass,
      value: (result.Value as { stringValue?: () => string })?.stringValue?.() }).toMatchObject(expected);
    if (!expected.diagnostic) expect(diagnostic).toBeUndefined();
  });
}
