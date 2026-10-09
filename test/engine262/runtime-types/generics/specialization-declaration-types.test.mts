import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/specialization-declaration-types.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; expected: Record<string, unknown> }[];
};

for (const { name, source, expected } of corpus.cases) {
  test(name, () => {
    const result = observeScript(source);
    expect({ ...result, completion: result.completion.Type,
      value: (result.completion.Value as { stringValue?: () => string })?.stringValue?.() }).toMatchObject(expected);
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  });
}

test('a failed deferred pattern obligation permits a corrected declaration in the same realm', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  try {
    const failed = EnsureCompletion(realm.evaluateScriptSkipDebugger('function outer(){function f<[].<Missing>>(x:string):string{return x;}}'));
    expect(failed.Type).toBe('throw');
    expect(TypeDiagnosticOf(failed.Value)).toMatchObject({ code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' });
    expect(bodyEntered).toBe(false);
    const corrected = EnsureCompletion(realm.evaluateScriptSkipDebugger('function outer(){type Known=string;function f<[].<Known>>(x:string):string{return x;}return "ok";}outer();'));
    expect(corrected.Type).toBe('normal');
    expect((corrected.Value as { stringValue(): string }).stringValue()).toBe('ok');
    expect(TypeDiagnosticOf(corrected.Value)).toBeUndefined();
    expect(bodyEntered).toBe(true);
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
});
