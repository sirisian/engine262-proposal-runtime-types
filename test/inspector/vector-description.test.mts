/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from 'vitest';
import { TestInspector } from './utils.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// ---------------------------------------------------------------------------
// A VECTOR VALUE'S DESCRIPTION NAMES ITS LANE TYPE, AND ITS LANES.
//
// `const a: int32x4 = int32x4(0, 1, 2, 3); a;` described itself as
// `vector.<[object Object], 4>(0, 1, 2, 3)`. The inspector's `typeNameOf` had a
// shorthand for a name with one numeric width argument (`uint32`) and, for any
// other parameterized type, interpolated each argument with `String(a)` - right
// for a number, `[object Object]` for the TYPE RECORD a vector's lane type is.
// `String(type int32x4)` beside it said `vector.<int.<32>, 4>`, because it goes
// through the engine's canonical formatter. The inspector now does too for
// anything parameterized, keeping the scalar shorthand the snapshots pin.
//
// The lanes had the same shape of bug one level down: a bit vector's lanes are
// themselves vectors, and a lane without a `.value` fell to `String(lane)`.
// ---------------------------------------------------------------------------

async function consoleSession() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const inspector = new TestInspector();
  const realm = new ManagedRealm();
  inspector.attachAgent(agent, [realm]);
  await inspector.debugger.engine262_setEvaluateMode({ mode: 'console' });
  return async (e: string) => {
    const r = (await inspector.eval(e)) as any;
    // A vector describes itself in `description`; a string result carries `value`.
    return (r.description ?? r.value) as string;
  };
}

test('the reported program: the lane type is spelled, not [object Object]', async () => {
  const d = await consoleSession();
  expect(await d('const a: int32x4 = int32x4(0, 1, 2, 3); a;')).toBe('vector.<int.<32>, 4>(0, 1, 2, 3)');
  expect(await d('float32x4(1.5, 2, 3, 4)')).toBe('vector.<float32, 4>(1.5, 2, 3, 4)');
  expect(await d('uint8x16(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)')).toBe('vector.<uint.<8>, 16>(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)');
});

test('the description matches what String(type ...) says for the same type', async () => {
  const d = await consoleSession();
  const described = await d('int32x4(0, 1, 2, 3)');
  const typeText = await d('String(type int32x4)');
  expect(described.startsWith(typeText)).toBe(true);
});

test('a bit vector\'s lanes, themselves vectors, render as nested lanes', async () => {
  const d = await consoleSession();
  // `boolean8x16`: sixteen 8-bit lanes, a 128-bit register. (`boolean8x4` is not
  // a shorthand - 32 bits fills no register - and was the first draft's mistake.)
  const text = await d('boolean8x16(1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0)');
  expect(text).not.toContain('[object Object]');
  expect(text.startsWith('vector.<vector.<uint.<1>, 8>, 16>((1, 0, 0, 0, 0, 0, 0, 0), (0, 0, 0, 0, 0, 0, 0, 0), ')).toBe(true);
});

test('the scalar shorthand is unchanged', async () => {
  const d = await consoleSession();
  expect(await d('uint8(5)')).toBe('5 (uint8)');
  expect(await d('int32(-3)')).toBe('-3 (int32)');
  expect(await d('float64(1.5)')).toBe('1.5 (float64)');
});
