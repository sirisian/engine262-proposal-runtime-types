import { expect, test } from 'vitest';
import { evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  ['replaced Proxy', 'Proxy=function(){};', 'function f(a:[].<uint8>){new Proxy(a,{});}f([1]);"ok";'],
  ['lexical Proxy', 'const Proxy=function(){};', 'function f(a:[].<uint8>){new Proxy(a,{});}f([1]);"ok";'],
  ['replaced revocable', 'Proxy.revocable=function(){return {};};', 'function f(a:[].<uint8>){Proxy.revocable(a,{});}f([1]);"ok";'],
  ['revocable getter is not run by checking', 'globalThis.calls=0;Object.defineProperty(Proxy,"revocable",{get(){calls++;return function(){};}});', 'function f(a:[].<uint8>){Proxy.revocable(a,{});}String(calls);', '0'],
  ['global getter is not run by checking', 'globalThis.calls=0;Object.defineProperty(globalThis,"Proxy",{get(){calls++;return function(){};}});', 'function f(a:[].<uint8>){new Proxy(a,{});}String(calls);', '0'],
  ['replaced Map adder', 'Map.prototype.set=function(){return this;};', 'new Map.<string,uint8>([["x","bad"]]);"ok";'],
  ['replaced Set adder', 'Set.prototype.add=function(){return this;};', 'new Set.<uint8>(["bad"]);"ok";'],
  ['replaced array iterator', 'Array.prototype[Symbol.iterator]=function*(){yield ["x",1];};', 'new Map.<string,uint8>([["x","bad"]]);"ok";'],
  ['replaced iterator next', 'Object.getPrototypeOf([][Symbol.iterator]()).next=function(){return {done:true};};', 'new Set.<uint8>(["bad"]);"ok";'],
  ['unknown free call', 'function replace(){Proxy=function(){};}', 'replace();function f(a:[].<uint8>){new Proxy(a,{});}f([1]);"ok";'],
  ['free global getter', 'Object.defineProperty(globalThis,"trigger",{get(){Proxy=function(){};return 1;}});', 'trigger;function f(a:[].<uint8>){new Proxy(a,{});}f([1]);"ok";'],
  ['coercive free value', 'globalThis.value={valueOf(){Proxy=function(){};return 1;}};', '+value;function f(a:[].<uint8>){new Proxy(a,{});}f([1]);"ok";'],
])('%s from an earlier script retains runtime resolution', (_name, setup, source, result = 'ok') => {
  expect(evaluatedSequence([setup, source])).toBe(result);
});

test('an eval checks against its real outer lexical binding', () => {
  expect(ok('function outer(){const Proxy=function(){};eval("function f(a:[].<uint8>){new Proxy(a,{});}f([1]);");}outer();')).toBe(true);
});

test('a canonical unused constructor alias is still known', () => {
  expectStaticTypeError('const P=Proxy;function f(a:[].<uint8>){new P(a,{});}');
});
