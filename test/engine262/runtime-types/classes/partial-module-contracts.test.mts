import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, FinishLoadingImportedModule, Get, Value, X, type JSStringValue } from '#self';

// #sec-partial-classes: extensions preserve the imported declaration's identity.
async function evaluateModules(modules: Record<string, string>, source: string): Promise<{ name: string, message: string, result: string }> {
  const cache = new Map<string, ReturnType<ManagedRealm['compileModule']>>();
  setSurroundingAgent(new Agent({ features: ['runtime-types'], hostHooks: {
    HostLoadImportedModule(referrer: unknown, request: { Specifier: string }, _host: unknown, payload: unknown) {
      if (!cache.has(request.Specifier)) cache.set(request.Specifier, realm.compileModule(modules[request.Specifier], { specifier: request.Specifier } as never));
      FinishLoadingImportedModule(referrer as never, request as never, payload as never, cache.get(request.Specifier) as never);
    },
  } } as never));
  const realm = new ManagedRealm();
  const completion = EnsureCompletion(await new Promise<unknown>((resolve) => realm.evaluateModule(source, 'main', resolve)) as never) as unknown as {
    Type: string, Value: { PromiseState?: string, PromiseResult?: Value },
  };
  const error = completion.Type === 'throw' ? completion.Value as unknown as Value
    : completion.Value?.PromiseState === 'rejected' ? completion.Value.PromiseResult : undefined;
  let name = '';
  let message = '';
  if (error) {
    const pop = realm.pushTopContext();
    try {
      name = (X(Get(X(Get(error as never, Value('constructor'))) as never, Value('name'))) as JSStringValue).stringValue();
      message = (X(Get(error as never, Value('message'))) as JSStringValue).stringValue();
    } finally {
      pop?.();
    }
  }
  const result = realm.evaluateScriptSkipDebugger('String(globalThis.result);') as unknown as { Value: { stringValue(): string } };
  return { name, message, result: result.Value.stringValue() };
}

const base = 'export class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } export interface I<T: type> { v: T; } export type Id = uint8;';
const extension = 'import { Box, I } from "base"; partial class Box<uint8> { extra(): string { return "ok"; } } partial interface I<uint8> { extra: string; }';

test('direct alias and interface exports link and evaluate', async () => {
  expect(await evaluateModules({ base }, 'import { Id, I } from "base"; const v: Id = 3; const i: I.<Id> = { v }; globalThis.result = String(i.v);'))
    .toEqual({ name: '', message: '', result: '3' });
});

test('a loaded module extends matching imported class applications', async () => {
  expect(await evaluateModules({ base, extension }, 'import { Box } from "base"; import "extension"; globalThis.result = new Box.<uint8>(1).extra();'))
    .toEqual({ name: '', message: '', result: 'ok' });
});

test('a loaded module publishes required interface members', async () => {
  const bad = await evaluateModules({ base, extension }, 'import { I } from "base"; import "extension"; let i: I.<uint8> = {v: 1}; globalThis.result = "ran";');
  expect(bad.name).toBe('StaticTypeError');
  expect(bad.message).toContain('extra');
  expect(bad.result).toBe('undefined');
  expect(await evaluateModules({ base, extension }, 'import { I } from "base"; import "extension"; let i: I.<uint8> = {v: 1, extra: "ok"}; globalThis.result = i.extra;'))
    .toEqual({ name: '', message: '', result: 'ok' });
});

test('overlapping imported contributions cannot replace one another', async () => {
  const collision = 'import { Box } from "base"; partial class Box<uint8> { extra(): string { return "other"; } }';
  const result = await evaluateModules({ base, extension, collision }, 'import { Box } from "base"; import "extension"; import "collision"; globalThis.result = new Box.<uint8>(1).extra();');
  expect(result.name).toBe('StaticTypeError');
  expect(result.message).toContain('already declared');
});


test('loading an extension updates applications already created by the exporting module', async () => {
  const prior = base + ' export const before = new Box.<uint8>(7); export const original = Box.<uint8>;';
  const source = 'import { Box, before, original } from "base"; import "extension"; globalThis.result = before.extra() + ":" + String(original === Box.<uint8>);';
  expect(await evaluateModules({ base: prior, extension }, source)).toEqual({ name: '', message: '', result: 'ok:true' });
});


test('a module which has not been loaded contributes no members', async () => {
  expect(await evaluateModules({ base, extension }, 'import { Box } from "base"; globalThis.result = typeof new Box.<uint8>(1).extra;'))
    .toEqual({ name: '', message: '', result: 'undefined' });
});


test('an imported alias retains its static assignment contract', async () => {
  const result = await evaluateModules({ base }, 'import { Id } from "base"; const bad: Id = "wrong"; globalThis.result = "ran";');
  expect(result.name).toBe('StaticTypeError');
  expect(result.result).toBe('undefined');
});
