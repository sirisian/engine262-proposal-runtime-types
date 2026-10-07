import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript, type ScriptCheckingMode } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/completed-binding-consumers.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source?: string; modules?: Record<string, string>; checking?: ScriptCheckingMode; expected: Record<string, unknown> }[];
};

for (const { name, source, modules, checking, expected } of corpus.cases) {
  test(name, async () => {
    const observation = modules ? await observeModuleGraph(modules) : (() => {
      const result = observeScript(source!, checking);
      return { ...result, completion: result.completion.Type,
        value: (result.completion.Value as { stringValue?: () => string })?.stringValue?.() };
    })();
    expect(observation).toMatchObject(expected);
    if (!expected.diagnostic) expect(observation.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(observation.errorClass).toBeUndefined();
  });
}
