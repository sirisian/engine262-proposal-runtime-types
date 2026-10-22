import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { observeModuleGraph, observeModuleSequence, type ModuleObservation } from '../module-observer.mts';

// #sec-specialization-predicate-completion and #sec-module-type-checking-order:
// neither handled unavailable reads nor mutable captures establish evidence.
const corpus = JSON.parse(readFileSync(new URL('../conformance/predicate-external-inputs.json', import.meta.url), 'utf8')) as {
  cases: { name: string; modules: Record<string, string>; expected: Partial<ModuleObservation> }[];
};

test.each(corpus.cases)('$name', async ({ modules, expected }) => {
  const result = await observeModuleGraph(modules);
  expect(result).toMatchObject(expected);
  if (!expected.errorClass) expect(result.errorClass).toBeUndefined();
  if (!expected.diagnostic) expect(result.diagnostic).toBeUndefined();
});

test('a failed cyclic check keeps prior effects, repeats no body and leaves independent checks usable', async () => {
  const graph = {
    main: 'import {use} from "dep";const input=false;function allowed():boolean{try{return input;}catch(e){return true;}}export type I<N:uint32> = uint32 where allowed();use();',
    dep: 'import "earlier";import {I} from "main";export function use(){I.<0>;}',
    earlier: 'globalThis.effects=(globalThis.effects||0)+1;',
    good: 'import "earlier";function allowed():boolean{try{throw new ReferenceError("input cannot be used before initialization");}catch(e){return true;}}type I<N:uint32> = uint32 where allowed();I.<0>;if(globalThis.effects!==1)throw new Error("repeated effect");',
  };
  const results = await observeModuleSequence(graph, ['main', 'main', 'good', 'good']);
  for (const result of results.slice(0, 2)) expect(result).toMatchObject({ status: 'rejected', errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION', phase: 'pre-evaluation', location: { nodeType: 'WhereClause' } } });
  expect(results[0].bodyEntries).toEqual(['earlier']);
  expect(results[1].bodyEntries).toEqual([]);
  expect(results[1].loaded).toEqual([]);
  expect(results[2]).toMatchObject({ status: 'fulfilled', bodyEntries: ['good'] });
  expect(results[3]).toMatchObject({ status: 'fulfilled', bodyEntries: [] });
});

test('budget exhaustion wins after a handled unavailable producer read', async () => {
  const result = await observeModuleGraph({
    main: 'import {use} from "dep";const input=true;function allowed():boolean{try{return input;}catch(e){let n=0;while(n<10000){n++;}return true;}}export type I<N:uint32> = uint32 where allowed();use();',
    dep: 'import {I} from "main";export function use(){I.<0>;}',
  }, 'main', { typeEvaluationBudget: { steps: 200 } });
  expect(result).toMatchObject({ status: 'rejected', bodyEntries: [], errorClass: 'StaticTypeError',
    diagnostic: { code: 'RT_TYPE_EVALUATION_LIMIT', phase: 'pre-evaluation' } });
});
