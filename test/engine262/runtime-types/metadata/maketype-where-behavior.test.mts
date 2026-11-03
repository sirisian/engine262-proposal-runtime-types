import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

const make = (predicate: string, base = 'number') => `Reflect.makeType({kind:'parameterized',base:${base},metadata:{where:${predicate}}})`;

test.each([
  ['true','true'], ['false','false'], ['1','true'], ['0','false'], ['"yes"','true'], ['""','false'], ['null','false'], ['undefined','false'], ['({})','true'], ['[]','true'], ['0n','false'], ['1n','true'], ['NaN','false'],
])('uses ordinary ToBoolean for %s', (result, expected) => {
  expect(evaluated(`const T=${make(`x=>${result}`)}; String(1 is T);`)).toBe(expected);
});

test.each(['x=>x>0', 'function(x){return x>0;}', 'x=>Number.isInteger(x)&&x>0', 'x=>Math.abs(x)>0'])('evaluates admitted predicate %s', (predicate) => {
  expect(evaluated(`const T=${make(predicate)}; String(2 is T)+','+String(0 is T);`)).toBe('true,false');
});

test.each(['Math.random()', 'Date.now()', 'eval("true")', 'x.some(y=>true)', '(x.a=1)', 'delete x.a', 'this', 'arguments', 'new Date()', 'new Proxy({}, {})'])('rejects unproved effects or ambient input: %s', (expression) => {
  expectThrownKind(`const p=function(x){return ${expression};}; ${make('p', 'any')};`, 'TypeError');
});

test('rejects a mutable lexical capture', () => {
  expectThrownKind(`let limit=0; const p=x=>x>limit; ${make('p')};`, 'TypeError');
});

test('rejects a const binding that retains mutable object state', () => {
  expectThrownKind(`const state={limit:0}; const p=x=>x>state.limit; ${make('p')};`, 'TypeError');
});

test('admits immutable primitive captures and pure helper functions', () => {
  expect(evaluated(`const limit=2; const helper=x=>x>limit; const p=x=>helper(x); const T=${make('p')}; String(3 is T)+','+String(1 is T);`)).toBe('true,false');
});

test('preserves activation-specific captures', () => {
  expect(evaluated(`function make(limit){const p=x=>x>limit; return ${make('p')};} const A=make(2),B=make(4); String(3 is A)+','+String(3 is B)+','+String(A===B);`)).toBe('true,false,false');
});

test('rejects a captured binding changed after admission', () => {
  expect(evaluated(`function make(limit){const p=x=>x>limit;const T=${make('p')};limit=9;return T;} const T=make(2); try{3 is T;}catch(e){String(e instanceof TypeError);}`)).toBe('true');
});

test('checks the base before running the predicate', () => {
  expect(evaluated(`const T=${make("x=>{throw 'predicate';}")}; String('x' is T);`)).toBe('false');
});

test('propagates predicate throws unchanged', () => {
  expect(evaluated(`const T=${make("x=>{throw 'predicate';}")}; try{1 is T;}catch(e){e;}`)).toBe('predicate');
});

test('candidate reads retain ordinary getters, once per predicate invocation', () => {
  expect(evaluated(`let reads=0; const p=x=>x.a>0;const T=${make('p','any')};const candidate={get a(){reads++;return 1;}}; candidate is T; candidate is T; reads;`)).toBe('2');
});

test('does not cache membership of mutable candidates', () => {
  expect(evaluated(`const p=x=>x.a>0;const T=${make('p','any')};const candidate={a:1};const before=candidate is T;candidate.a=-1; String(before)+','+String(candidate is T);`)).toBe('true,false');
});

test('guards a replaced intrinsic after predicate admission', () => {
  expect(evaluated(`const p=x=>Math.abs(x)>0; const T=${make('p')}; Math.abs=x=>0;try{1 is T;}catch(e){String(e instanceof TypeError);}`)).toBe('true');
});

test('guards intrinsic replacement during argument evaluation', () => {
  expect(evaluated(`const p=x=>Math.abs(x.a)>0;const T=${make('p','any')}; const candidate={get a(){Math.abs=x=>0;return 1;}};try{candidate is T;}catch(e){String(e instanceof TypeError);}`)).toBe('true');
});

test('rejects a replaced library member even before admission', () => {
  expectThrownKind(`Math.abs=x=>true; const p=x=>Math.abs(x);${make('p')};`, 'TypeError');
});

test('local scalar mutation and loops remain evaluable', () => {
  expect(evaluated(`const p=x=>{let sum=0;for(let i=0;i<x;i++)sum+=i;return sum>2;};const T=${make('p')};String(4 is T)+','+String(1 is T);`)).toBe('true,false');
});

test.each(['startsWith("a")', 'endsWith("c")', 'includes("b")', 'toUpperCase()==="ABC"', 'slice(1)==="bc"'])('guards deterministic string method %s', (operation) => {
  expect(evaluated(`const p=x=>x.${operation};const T=${make('p','string')};String('abc' is T);`)).toBe('true');
});

test('a candidate cannot supply a different implementation of an admitted method', () => {
  expect(evaluated(`const p=x=>x.startsWith('a');const T=${make('p','any')};const input={startsWith(){throw 'wrong';}};try{input is T;}catch(e){String(e instanceof TypeError);}`)).toBe('true');
});

test('a fresh RegExp literal can test its candidate', () => {
  expect(evaluated(`const p=x=>/^a+$/.test(x);const T=${make('p','string')};String('aaa' is T)+','+String('bbb' is T);`)).toBe('true,false');
});

test('preserves an ordinary thrown Error object', () => {
  expect(evaluated(`const p=x=>{throw new RangeError('predicate');};const T=${make('p')};try{1 is T;}catch(e){e.message+','+String(e instanceof RangeError);}`)).toBe('predicate,true');
});

test('re-admitting a callback cannot reset its retained capture guard', () => {
  expect(evaluated(`function make(limit){const p=x=>x>limit;const T=${make('p')};limit=9;try{${make('p')};}catch(e){return String(e instanceof TypeError);}return 'wrong';}make(2);`)).toBe('true');
});

test('a changed capture cannot be read after a candidate getter', () => {
  expect(evaluated(`function make(limit){const p=x=>x.a>limit;const T=${make('p','any')};const input={get a(){limit=9;return 3;}};try{input is T;}catch(e){return String(e instanceof TypeError);}return 'wrong';}make(2);`)).toBe('true');
});

test.each(['Math.random()', 'Math["random"]()', '(() => Math.random())()'])('rejects a captured constant initialized by %s', (initializer) => {
  expectThrownKind(`const limit=${initializer};const p=x=>x>limit;${make('p')};`, 'TypeError');
});

test.each([
  'function helper(v){return v>0;}return helper(x);',
  'const helper=v=>v>0;return helper(x);',
  'function helper(v){return v<=0?false:v===1?true:helper(v-1);}return helper(x);',
])('admits a lexically local helper: %s', (body) => {
  expect(evaluated(`const T=${make(`x=>{${body}}`)};String(3 is T)+','+String(0 is T);`)).toBe('true,false');
});

test.each(['for(x.a of [1]){}', 'for(x.a in {a:1}){}', 'let ref r=x.a;r=2;'])('rejects an indirect candidate write: %s', (body) => {
  expectThrownKind(`const p=x=>{${body}return true;};${make('p','any')};`, 'TypeError');
});

test('rejects a by-reference predicate parameter', () => {
  expectThrownKind(`const p=function(ref x){return true;};${make('p')};`, 'TypeError');
});

test('rejects ambient mutable class state', () => {
  expectThrownKind(`class C{static limit=1;} const p=x=>x>C.limit;${make('p')};`, 'TypeError');
});

test.each(['NaN','Infinity','undefined'])('does not mistake a shadowed %s for an intrinsic constant', (name) => {
  expectThrownKind(`{let ${name}=1;const p=x=>x>${name};${make('p')};}`, 'TypeError');
});

test('rejects mutable properties of a captured helper function', () => {
  expectThrownKind(`function helper(x){return x;}helper.limit=1;${make('x=>x>helper.limit')};`, 'TypeError');
});

test('does not invoke an accessor on a captured helper during admission', () => {
  expect(evaluated(`function helper(x){return x;}let reads=0;Object.defineProperty(helper,'limit',{get(){reads++;return 1;}});try{${make('x=>x>helper.limit')};}catch{}reads;`)).toBe('0');
});


test('rejects arbitrary mutable global properties', () => {
  expectThrownKind(`globalThis.limit=1;${make('x=>x>limit')};`, 'TypeError');
});

test('admits a readonly deterministic Math constant', () => {
  expect(evaluated(`const T=${make('x=>x>Math.PI')};String(4 is T)+','+String(3 is T);`)).toBe('true,false');
});
