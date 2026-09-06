/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from 'vitest';
import { TestInspector } from './utils.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// ---------------------------------------------------------------------------
// A CONSOLE ENTRY THAT IS MODULE CODE STILL ECHOES ITS LAST EXPRESSION.
//
// A console entry that declares an `import` or `export` is module code and
// cannot parse as a script, so it takes the module goal. The console then echoed
// the module NAMESPACE object - `Module {Symbol(Symbol.toStringTag): 'Module'}`
// - instead of the value of the entry's last expression, so
//
//   import { partial } from 'std:types';
//   type Vector = { x: number, y: number };
//   type PartialVector = partial(Vector);
//   PartialVector;
//
// showed `Module`, and seeing the type needed a `console.log`. A script entry
// echoes its trailing expression; a module entry now does too. `ExecuteModule`
// stashes the body's completion value and the console reads it, falling back to
// the namespace only for an entry that produced no value.
// ---------------------------------------------------------------------------

async function consoleSession() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const inspector = new TestInspector();
  const realm = new ManagedRealm();
  inspector.attachAgent(agent, [realm]);
  await inspector.debugger.engine262_setEvaluateMode({ mode: 'console' });
  return async (e: string) => {
    const r = await inspector.eval(e) as any;
    return { className: r?.className, description: r?.description, value: r?.value };
  };
}

test('the reported program echoes the type, not the module namespace', async () => {
  const ev = await consoleSession();
  const r = await ev([
    "import { partial } from 'std:types';",
    'type Vector = { x: number, y: number };',
    'type PartialVector = partial(Vector);',
    'PartialVector;',
  ].join('\n'));
  expect(r.className).toBe('Type');
  expect(r.description).toBe('{ x?: number, y?: number }');
});

test('a module entry ending in a plain expression echoes its value', async () => {
  const ev = await consoleSession();
  const r = await ev("import { partial } from 'std:types';\n1 + 1;");
  expect(r.value).toBe(2);
});

test('an export entry ending in an expression echoes it', async () => {
  const ev = await consoleSession();
  const r = await ev('export const y = 7;\ny;');
  expect(r.value).toBe(7);
});

test('a module entry that is all imports and declarations still shows the namespace', async () => {
  const ev = await consoleSession();
  const r = await ev("import { partial } from 'std:types';\nconst x = 5;");
  expect(r.className).toBe('Module');
});

test('the stashed value does not leak: a later all-declaration entry shows the namespace', async () => {
  const ev = await consoleSession();
  expect((await ev("import { partial } from 'std:types';\n42;")).value).toBe(42);
  const second = await ev("import { partial } from 'std:types';\nconst z = 1;");
  expect(second.className).toBe('Module');
});

test('a following script entry re-evaluates rather than echoing the module\'s value', async () => {
  const ev = await consoleSession();
  expect((await ev("import { partial } from 'std:types';\n99;")).value).toBe(99);
  expect((await ev('2 + 2')).value).toBe(4);
});
