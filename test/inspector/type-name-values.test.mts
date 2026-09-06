/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from 'vitest';
import { TestInspector } from './utils.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// ---------------------------------------------------------------------------
// TYPE-NAME VALUES RESOLVE IN THE CONSOLE.
//
// `#sec-type-names` binds the built-in type names - `uint8`, `complex64`, the
// SIMD shorthands `int32x4`, `type` itself - into a per-source-text environment
// rather than as global object properties, so that loading a typed module does
// not change `typeof string` in untyped scripts beside it. That environment is
// consulted only where the running text ADMITS type names.
//
// Three eval paths must set `AdmitsTypeNames`: `PerformEval` (direct eval), the
// console's non-REPL branch (on the ScriptRecord), and `performDevtoolsEval` -
// which the devtools console takes for EVERY entry, via `replMode`/console mode.
// The third set neither, so every type-name value was undefined in the console:
// `int32x4(0, 1, 2, 3)` reported `"int32x4" is not defined`, while the same text
// run as a file worked. (Regressed when the names moved off the global object.)
// ---------------------------------------------------------------------------

async function consoleSession() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const inspector = new TestInspector();
  const realm = new ManagedRealm();
  inspector.attachAgent(agent, [realm]);
  // console mode takes the same performDevtoolsEval path the devtools console
  // takes for every entry.
  await inspector.debugger.engine262_setEvaluateMode({ mode: 'console' });
  return {
    inspector,
    val: async (e: string) => {
      const r = await inspector.eval(e) as any;
      return r?.value ?? r?.description ?? r?.exceptionDetails?.exception?.description?.split('\n')[0];
    },
  };
}

test('the reported program - a SIMD shorthand in the console', async () => {
  const { val } = await consoleSession();
  expect(await val('const a: int32x4 = int32x4(0, 1, 2, 3); String(a);')).toBe('(0, 1, 2, 3)');
  expect(await val('String(int32x4(0, 1, 2, 3))')).toBe('(0, 1, 2, 3)');
});

test('a value declared on one console entry is used on the next', async () => {
  const { val } = await consoleSession();
  // The declaration statement itself completes with undefined, as `const h = 5;`
  // does; the value is read on the next entry, which is the point.
  await val('const g: int32x4 = int32x4(9, 8, 7, 6);');
  expect(await val('String(g)')).toBe('(9, 8, 7, 6)');
});

test('the numeric type names, complex shorthands, and `type` all resolve as values', async () => {
  const { val } = await consoleSession();
  expect(await val('String(uint8(5))')).toBe('5');
  expect(await val('String(int32(-3))')).toBe('-3');
  expect(await val('String(float32(1.5))')).toBe('1.5');
  expect(await val('String(complex64(2))')).toBe('2+0i');
  expect(await val('String(type uint8)')).toBe('uint.<8>');
  expect(await val('String(uint8 === uint8)')).toBe('true');
});

test('every register-filling SIMD shorthand constructs', async () => {
  const { val } = await consoleSession();
  const bad: string[] = [];
  for (const base of ['int', 'uint', 'float']) {
    for (const w of [8, 16, 32, 64]) {
      if (base === 'float' && w === 8) continue;
      for (const lanes of [2, 4, 8, 16, 32]) {
        if (w * lanes !== 128 && w * lanes !== 256) continue;
        const name = `${base}${w}x${lanes}`;
        const args = Array.from({ length: lanes }, (_, i) => i).join(', ');
        const r = await val(`String(${name}(${args}) is ${name})`);
        if (r !== 'true') bad.push(`${name}: ${r}`);
      }
    }
  }
  for (const w of [8, 16, 32, 64]) {
    for (const lanes of [2, 4, 8, 16]) {
      if (w * lanes !== 128 && w * lanes !== 256) continue;
      const name = `boolean${w}x${lanes}`;
      const args = Array.from({ length: lanes }, (_, i) => i % 2).join(', ');
      const r = await val(`String(${name}(${args}) is ${name})`);
      if (r !== 'true') bad.push(`${name}: ${r}`);
    }
  }
  expect(bad).toEqual([]);
});

test('an untyped console entry still does not admit - a bare global keyword is not a type value', async () => {
  // The regression was the names being unreachable; the fix must not make them
  // reachable where the text does not admit. An entry with no type syntax and
  // no prior admitting entry resolves `string` as the ordinary global, so
  // `typeof string` is 'undefined', not a Type Object.
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const inspector = new TestInspector();
  const realm = new ManagedRealm();
  inspector.attachAgent(agent, [realm]);
  await inspector.debugger.engine262_setEvaluateMode({ mode: 'console' });
  const r = await inspector.eval('typeof string') as any;
  expect(r?.value).toBe('undefined');
});
