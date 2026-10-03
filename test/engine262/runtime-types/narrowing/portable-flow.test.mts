import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript } from '../harness.mts';

interface Fixture { id: string; source: string; uncheckedSource: string; expected: 'accept' | 'reject'; rules: string[] }
const corpus = JSON.parse(readFileSync(new URL('../conformance/boolean-flow.json', import.meta.url), 'utf8')) as { cases: Fixture[] };

test.each(corpus.cases)('$id follows the independent Boolean transfer model', (fixture) => {
  const result = observeScript(fixture.source);
  expect(result.completion.Type).toBe(fixture.expected === 'reject' ? 'throw' : 'normal');
  expect(result.bodyEntered).toBe(fixture.expected === 'accept');
  if (fixture.expected === 'reject') {
    expect(result.errorClass).toBe('StaticTypeError');
    expect(fixture.rules).toContain(result.diagnostic?.rule);
  }
});

test.each(corpus.cases)('$id preserves the unchecked JavaScript boundary', (fixture) => {
  for (const mode of ['disabled', 'automatic'] as const) {
    const result = observeScript(fixture.uncheckedSource, mode);
    expect(result.completion.Type).toBe('normal');
    expect(result.bodyEntered).toBe(true);
    expect(result.diagnostic).toBeUndefined();
  }
});
