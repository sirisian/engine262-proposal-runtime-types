import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript, settledAfterJobs, type ScriptCheckingMode } from '../harness.mts';
import { Agent, EnsureCompletion, ManagedRealm, TypeDiagnosticOf, setSurroundingAgent } from '#self';

const corpus = JSON.parse(readFileSync(new URL('../conformance/recursive-result-state.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; checking?: ScriptCheckingMode; expected: Record<string, unknown> }[];
};

for (const { name, source, checking, expected } of corpus.cases) {
  test(name, () => {
    const result = observeScript(source, checking);
    const observation = { ...result, completion: result.completion.Type,
      value: (result.completion.Value as { stringValue?: () => string })?.stringValue?.() };
    expect(observation).toMatchObject(expected);
    if (!expected.diagnostic) expect(observation.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(observation.errorClass).toBeUndefined();
  });
}

for (const reverse of [false, true]) {
  test(`async unknown join withdraws its former fulfillment contract, reverse=${reverse}`, () => {
    const declarations = [
      'async function a(n:uint32){return n > 0 ? await b(n) : globalThis.seed;}',
      'async function b(n:uint32){return await a(n);}',
    ];
    if (reverse) declarations.reverse();
    expect(settledAfterJobs(`globalThis.seed = 's'; ${declarations.join('\n')}
      b(0).then(value => { globalThis.settled = String(value); },
        error => { globalThis.settled = 'error:' + error; });`)).toBe('s');
  });
}

for (const failure of [
  'function grow(n:uint32){return [grow(n)];}',
  'function a(n:uint32){return n > 0 ? b(n) : globalThis.seed;} function b(n:uint32){return a(n);} const x := b(0);',
]) {
  test(`a rejected inference does not poison a later script: ${failure}`, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    let bodyEntered = false;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === 'ScriptBody') bodyEntered = true;
    };
    try {
      const rejected = EnsureCompletion(realm.evaluateScriptSkipDebugger(failure));
      expect(rejected.Type).toBe('throw');
      expect(bodyEntered).toBe(false);
      expect(TypeDiagnosticOf(rejected.Value)).toMatchObject({ phase: 'static',
        code: failure.includes('grow') ? 'RT_RETURN_INFERENCE' : 'RT_DECLARATION_INFERENCE' });
      const accepted = EnsureCompletion(realm.evaluateScriptSkipDebugger(`globalThis.seed = 's';
        function a(n:uint32){return n > 0 ? b(n) : globalThis.seed;}
        function b(n:uint32){return a(n);}
        const result:string=b(0); result;`));
      expect(accepted.Type).toBe('normal');
      expect(bodyEntered).toBe(true);
      expect((accepted.Value as { stringValue(): string }).stringValue()).toBe('s');
      expect(TypeDiagnosticOf(accepted.Value)).toBeUndefined();
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}

test('an unknown join retains the consuming boundary instead of a stale return check', () => {
  const source = corpus.cases.find(({ name }) => name === 'unknown-result-retains-consumer-boundary')!.source;
  const result = observeScript(source);
  expect(result.bodyEntered).toBe(true);
  expect(result.errorClass).toBe('TypeError');
  expect((result.completion.Value as { HostDefinedMessageString?: string }).HostDefinedMessageString)
    .toBe('TypeError: "s" is not assignable to "number"');
});
