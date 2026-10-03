import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript, type ScriptCheckingMode } from '../harness.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/inference-anchoring.json', import.meta.url), 'utf8')) as {
  cases: { name: string; source: string; checking?: ScriptCheckingMode; expected: Record<string, unknown> }[];
};

for (const { name, source, checking, expected } of corpus.cases) {
  test(name, () => {
    const result = observeScript(source, checking);
    expect({ ...result, completion: result.completion.Type,
      value: (result.completion.Value as { stringValue?: () => string })?.stringValue?.() }).toMatchObject(expected);
    if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
    if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  });
}
