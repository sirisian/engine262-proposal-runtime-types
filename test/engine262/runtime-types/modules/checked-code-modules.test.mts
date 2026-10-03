import { test, expect } from 'vitest';
import { observeModuleGraph } from '../module-observer.mts';

async function runWith(specifier: string, source: string, body: string) {
  const result = await observeModuleGraph({ main: body, [specifier]: source });
  return {
    status: result.status === 'fulfilled' ? 'ok' : 'rejected',
    bodyRan: result.bodyEntries.includes('main'),
    dependencyRan: result.bodyEntries.includes(specifier),
    errorClass: result.errorClass,
    diagnostic: result.diagnostic,
  };
}

const TYPED = 'export let x: uint8 = 1;';

test('a module without proposal syntax keeps its behaviour', async () => {
  expect(await runWith('typed', TYPED, 'if ([]) {} for (const v of []) {}'))
    .toMatchObject({ status: 'ok', bodyRan: true });
});

test('and so does one importing a typed binding', async () => {
  expect(await runWith('typed', TYPED, 'import { x } from "typed"; if (x === 300) {} if ([]) {}'))
    .toMatchObject({ status: 'ok', bodyRan: true });
});

test.each([
  'let checked: number = 0; function u() { if ([]) {} }',
  'import { x } from "typed"; let checked: number = 0; function u() { if ([]) {} }',
])('checked module rejection precedes its body: %s', async (body) => {
  expect(await runWith('typed', TYPED, body)).toMatchObject({
    status: 'rejected', bodyRan: false, errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_CONSTANT_CONDITION' },
  });
});

test.each(['', 'await 0;'])('a module performs deferred checking after its dependency and before its body: %s', async (suspension) => {
  expect(await runWith('typed', TYPED, `import { x } from 'typed'; ${suspension} type Invalid = float32.<{ unknownKey: 1 }>;`)).toMatchObject({
    status: 'rejected', bodyRan: false, dependencyRan: true, errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_UNCLAIMED_METADATA', phase: 'pre-evaluation' },
  });
});
