import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-specialization-predicate-completion: a local clause retains the
// required module inputs of imported helpers, including transitive captures.
const corpus = JSON.parse(readFileSync(new URL('../conformance/predicate-helper-captures.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});


test('a failed imported helper check clears required-input state for independent checks', async () => {
  const results = await observeModuleSequence({
    main: 'import "earlier";import {minimum} from "consumer";export function check(n){try{return n>=minimum;}catch(e){return true;}}',
    consumer: 'import {check} from "main";export const minimum=1;function F<N:uint32>():void where check(N){}function unused(){F.<1>();}',
    earlier: 'globalThis.effects=(globalThis.effects||0)+1;',
    good: 'import "earlier";const minimum=1;function check(n){try{return n>=minimum;}catch(e){return false;}}function F<N:uint32>():void where check(N){}F.<1>();if(globalThis.effects!==1)throw new Error("effects");',
  }, ['main', 'main', 'good', 'good']);
  for (const result of results.slice(0, 2)) expect(result).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation' } });
  expect(results[0].bodyEntries).toEqual(['earlier']);
  expect(results[1].bodyEntries).toEqual([]);
  expect(results[1].loaded).toEqual([]);
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
  for (const result of results.slice(2)) {
    expect(result.errorClass).toBeUndefined();
    expect(result.diagnostic).toBeUndefined();
  }
});

test('budget exhaustion outranks a caught unavailable capture in an imported helper', async () => {
  const result = await observeModuleGraph({
    main: 'import "consumer";const minimum=1;export function check(n){try{return n>=minimum;}catch(e){let i=0;while(i<10000){i++;}return true;}}',
    consumer: 'import {check} from "main";function F<N:uint32>():void where check(N){}function unused(){F.<1>();}',
  }, 'main', { typeEvaluationBudget: { steps: 200 } });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' } });
});
