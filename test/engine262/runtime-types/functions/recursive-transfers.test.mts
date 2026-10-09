import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeScript, settledAfterJobs, type ScriptCheckingMode } from '../harness.mts';

const corpus = JSON.parse(readFileSync(new URL('../conformance/recursive-transfers.json', import.meta.url), 'utf8')) as {
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

test('recursive generic fulfillment settles to the forwarded value', () => {
  const source = corpus.cases.find(({ name }) => name === 'async-generic-positive')!.source;
  expect(settledAfterJobs(`${source}
    value.then(result => { globalThis.settled = String(result); },
      error => { globalThis.settled = 'error:' + error; });`)).toBe('7');
});

test('recursive generic fulfillment uses each invocation binding', () => {
  const source = corpus.cases.find(({ name }) => name === 'async-generic-positive')!.source;
  expect(settledAfterJobs(`${source}
    (async () => {
      globalThis.settled = String(await value) + ':' + String(await f11.<string>(0, 's'));
    })().catch(error => { globalThis.settled = 'error:' + error; });`)).toBe('7:s');
});

test('async generator return joins fulfilled alternatives', () => {
  const source = corpus.cases.find(({ name }) => name === 'async-generator-return-positive')!.source;
  expect(settledAfterJobs(`${source}
    iterator.next().then(result => { globalThis.settled = String(result.value) + ':' + result.done; },
      error => { globalThis.settled = 'error:' + error; });`)).toBe('7:true');
});
