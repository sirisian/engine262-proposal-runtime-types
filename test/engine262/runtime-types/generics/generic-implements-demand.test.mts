import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-interfaces-semantics: open targets retain specialization obligations;
// closed targets keep declaration checks and evaluated interface identities.
const corpus = JSON.parse(readFileSync(new URL('../conformance/generic-implements-demand.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!('errorClass' in expected)) expect(result.errorClass).toBeUndefined();
  if (!('diagnostic' in expected)) expect(result.diagnostic).toBeUndefined();
});

test('failed interface binding does not cache an incomplete specialization', async () => {
  const result = await observeModuleGraph({ main: `
    interface I<T:type extends string>{get():T;}
    class E<T:type> implements I.<T>{get():T{throw new Error("unused");}}
    const F:any=E;
    let failures=0;
    for(let i=0;i<2;i+=1){try{F.<uint8>;}catch(error){if(error instanceof TypeError)failures+=1;}}
    const C=F.<string>;
    if(failures!==2||C!==F.<string>||!Reflect.isAssignable(Reflect.typeOf(new C()),I.<string>))throw new Error("cache");
  ` });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['main'] });
  expect(result.errorClass).toBeUndefined();
  expect(result.diagnostic).toBeUndefined();
});

test('a failed graph restores contexts before another graph in the same realm', async () => {
  const modules = {
    bad: 'interface I<T:type extends string>{get():T;}class E<T:type> implements I.<T>{get():T{throw new Error("unused");}}const F:any=E;F.<uint8>;',
    main: 'import {E} from "dep";export interface Has<T:type>{get():T;}const a=new E.<string>();if(!Reflect.isAssignable(Reflect.typeOf(a),Has.<string>))throw new Error("context");',
    dep: 'import {Has} from "main";export class E<T:type> implements Has.<T>{get():T{throw new Error("unused");}}',
  };
  const [failed, good, repeated] = await observeModuleSequence(modules, ['bad', 'main', 'main']);
  expect(failed).toMatchObject({ status: 'rejected', bodyEntries: ['bad'], errorClass: 'TypeError' });
  expect(failed.diagnostic).toBeUndefined();
  expect(good).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(repeated).toMatchObject({ status: 'fulfilled', loaded: [], bodyEntries: [] });
  for (const result of [good, repeated]) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});
