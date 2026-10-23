import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, ObjectValue, JSStringValue,
  CopyValueClassInstance, skipDebugger, Throw,
} from '#self';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-soa-references, #sec-reference-liveness and #sec-value-type-copying.
const corpus = JSON.parse(readFileSync(new URL('../conformance/soa-reference-liveness.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('failed module evaluation stays cached while a later module explicitly reborrows', async () => {
  const results = await observeModuleSequence({
    dep: 'class P{x:uint8;}const a=SoA.withCapacity.<P>(8);a.push({x:1});export let ref r=a[0];globalThis.effects=0;export function invalidate(){globalThis.effects++;a.pop();a.push({x:2});}export function repair(){ref r=a[0];}',
    bad: 'import {r,invalidate} from "dep";invalidate();const copy:any=r;',
    good: 'import {r,repair} from "dep";repair();if(r.x!==2||globalThis.effects!==1)throw new Error("repair");',
  }, ['bad', 'bad', 'good', 'good', 'bad']);
  for (const index of [0, 1, 4]) {
    expect(results[index]).toMatchObject({ status: 'rejected', errorClass: 'TypeError' });
    expect(results[index].diagnostic).toBeUndefined();
  }
  expect(results[0].bodyEntries).toEqual(['dep', 'bad']);
  for (const index of [1, 3, 4]) {
    expect(results[index].loaded).toEqual([]);
    expect(results[index].bodyEntries).toEqual([]);
  }
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2, 4)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('the copy operation propagates an abrupt field read without losing earlier reads', () => {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const initialized = EnsureCompletion(realm.evaluateScriptSkipDebugger('class P{x:uint8;y:uint8;}new P();'));
  expect(initialized.Type).toBe('normal');
  if (!(initialized.Value instanceof ObjectValue)) throw new Error('missing copy source');
  const source = initialized.Value;
  const popContext = realm.pushTopContext();
  const originalGet = source.Get;
  try {
    const failure = Throw.TypeError('copy field failed');
    const reads: string[] = [];
    source.Get = function* (key, receiver) {
      const name = key instanceof JSStringValue ? key.stringValue() : undefined;
      if (name === 'x') reads.push('x');
      if (name === 'y') { reads.push('y'); return failure; }
      return yield* originalGet.call(this, key, receiver);
    };
    const result = EnsureCompletion(skipDebugger(CopyValueClassInstance(source)));
    expect(result.Type).toBe('throw');
    expect(result.Value).toBe(failure.Value);
    expect(reads).toEqual(['x', 'y']);
  } finally {
    source.Get = originalGet;
    popContext?.();
  }
});
