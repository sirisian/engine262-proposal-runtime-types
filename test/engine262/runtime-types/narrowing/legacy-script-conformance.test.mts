import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript, type ScriptCheckingMode } from '../harness.mts';
import type { JSStringValue } from '#self';

interface Outcome {
  completion: 'normal' | 'throw';
  bodyEntered: boolean;
  errorClass?: string;
  rule?: string;
  value?: string;
}
interface Fixture { id: string; source: string; expected: Record<ScriptCheckingMode, Outcome> }
const corpus = JSON.parse(readFileSync(new URL('../conformance/legacy-script-outcomes.json', import.meta.url), 'utf8')) as { cases: Fixture[] };

for (const mode of ['disabled', 'automatic', 'forced'] as const) {
  test.each(corpus.cases)(`$id has the expected ${mode} outcome`, (fixture) => {
    const result = observeScript(fixture.source, mode);
    const expected = fixture.expected[mode];
    expect(result.completion.Type).toBe(expected.completion);
    expect(result.bodyEntered).toBe(expected.bodyEntered);
    expect(result.errorClass).toBe(expected.errorClass);
    expect(result.diagnostic?.rule).toBe(expected.rule);
    if (expected.value !== undefined) expect((result.completion.Value as JSStringValue).stringValue()).toBe(expected.value);
    if (expected.rule) expect(result.diagnostic).toMatchObject({ phase: 'static', checked: true, errorClass: 'StaticTypeError' });
  });
}
