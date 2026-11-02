import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { nativeErrorClass } from '../error-observer.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf } from '#self';

// Preserve one realm across sequence steps: a later Script may replace a
// mutable global constructor before the first invocation of an earlier body.
const corpus = JSON.parse(readFileSync(new URL('../conformance/deferred-global-constructors.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; expected: Record<string, unknown> }[];
  sequences: { name: string; sources: string[]; expected: Record<string, unknown>[] }[];
};
const cases = [
  ...corpus.cases.map(({ name, source, expected }) => ({ name, sources: [source], expected: [expected] })),
  ...corpus.sequences,
];
for (const { name, sources, expected } of cases) {
  test(name, () => {
    const agent = new Agent({ features: ['runtime-types'] });
    setSurroundingAgent(agent);
    const realm = new ManagedRealm();
    expect(sources).toHaveLength(expected.length);
    try {
      sources.forEach((source, index) => {
        let bodyEntries = 0;
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === 'ScriptBody') bodyEntries += 1;
        };
        const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        const diagnostic = TypeDiagnosticOf(result.Value);
        const errorClass = result.Type === 'throw' ? nativeErrorClass(result.Value, realm) : undefined;
        const value = result.Type === 'normal' ? (result.Value as { stringValue?: () => string })?.stringValue?.() : undefined;
        expect({ completion: result.Type, bodyEntries, errorClass, diagnostic, value }).toMatchObject(expected[index]);
        if (!expected[index].errorClass) expect(errorClass).toBeUndefined();
        if (!expected[index].diagnostic) expect(diagnostic).toBeUndefined();
        expect(agent.jobQueue.length, 'jobs settle before the next Script').toBe(0);
      });
    } finally {
      delete agent.hostDefinedOptions.onNodeEvaluation;
    }
  });
}
