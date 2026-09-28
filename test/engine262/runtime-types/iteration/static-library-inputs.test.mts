import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "Object.keys.<uint8>({});",
  "const n:uint8=1;Promise.all(n);",
  "Array.from(Composite.<[string]>([\"s\"]),(x:uint8):uint8=>x);",
  "const callback:uint8=1;Array.from(Composite.<[string]>([\"s\"]),callback);",
  "const keys=Object.keys;keys.<uint8>({});",
  "const n:uint8=1;Promise.race(n);",
  "const n:uint8=1;Promise.any(n);",
  "const n:uint8=1;Promise.allSettled(n);",
  "Array.fromAsync(Composite.<[string]>([\"s\"]),(x:uint8):uint8=>x);",
  "Object.groupBy(Composite.<[string]>([\"s\"]),(x:uint8):uint8=>x);",
  "Map.groupBy(Composite.<[string]>([\"s\"]),(x:uint8):uint8=>x);",
  "Array.from(Composite.<[string]>([\"s\"]),(x:string,y:uint32,z:uint8):string=>x);"
])('rejects an invalid established contract: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "Object.keys({x:1});",
  "Object.keys=function<T:type>(x:T):T{return x;};Object.keys.<uint8>(1);",
  "const Object={keys<T:type>(x:T):T{return x;}};Object.keys.<uint8>(1);",
  "function unused(f:any){f.<uint8>(1);}",
  "function unused(){Object.keys.<uint8>({});}",
  "Promise.all([1]).then(v=>globalThis.__observation=v[0]);",
  "Promise.all=function(x){return Promise.resolve(x);};const n:uint8=1;Promise.all(n).then(v=>globalThis.__observation=v);",
  "function unused(x:any){Promise.all(x);}",
  "function unused(n:uint8){Promise.all(n);}",
  "Array.from(Composite.<[string]>([\"s\"]),(x:string):string=>x);",
  "Array.from=function(items,callback){return [];};Array.from(Composite.<[string]>([\"s\"]),(x:uint8):uint8=>x);",
  "function unused(source:any,callback:any){Array.from(source,callback);}",
  "function unused(source:Composite.<[string]>){Array.from(source,(x:uint8):uint8=>x);}",
  "Array.from(Composite.<[string]>([\"s\"]),(x:string,i:string):string=>i);",
  "Array.from(Composite.<[string]>([\"s\"]),undefined);",
  "Map.groupBy(Composite.<[string]>([\"s\"]),(x:string):string=>x);",
  "Array.fromAsync(Composite.<[string]>([\"s\"]),(x:string):string=>x);",
  "function unused(){Array.from.<uint8>([1]);Array.of.<uint8>(1);Object.values.<uint8>({x:1});Object.entries.<uint8>({x:1});}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test('an earlier script may replace a generic capability or static callback operation', () => {
  expect(evaluatedSequence([
    'Object.keys=function<T:type>(x:T):T{return x;};Array.from=function(){return [];}; "ready";',
    'Object.keys.<uint8>(1);Array.from(Composite.<[string]>(["s"]),(x:uint8):uint8=>x); "accepted";',
  ])).toBe('accepted');
});

test('primitive iteration may be supplied by an earlier prototype change', () => {
  expect(evaluatedSequence([
    'Number.prototype[Symbol.iterator]=function(){return [1][Symbol.iterator]();}; "ready";',
    'const n:uint8=1;Promise.all(n); "accepted";',
  ])).toBe('accepted');
});

test('Composite grouping accounts for the engine iterator step dependency', () => {
  expect(evaluatedSequence([
    'Object.getPrototypeOf([][Symbol.iterator]()).next=function(){return {done:true};}; "ready";',
    'Map.groupBy(Composite.<[string]>(["s"]),(x:uint8):uint8=>x); "accepted";',
  ])).toBe('accepted');
});

test('a computed global replacement defeats static operation provenance', () => {
  expect(ok('globalThis["Promise"]={all(x){return x;}};const n:uint8=1;Promise.all(n);')).toBe(true);
});

test('an explicit any alias retains runtime genericity checking', () => {
  expect(ok('const erased:any=Object.keys;const keys=erased;try{keys.<uint8>({});}catch(e){}')).toBe(true);
});
