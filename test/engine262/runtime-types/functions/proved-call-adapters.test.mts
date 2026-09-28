import { expect, test } from 'vitest';
import { evaluatedSequence, expectStaticTypeError, ok } from '../harness.mts';

// #sec-proved-library-operations; #sec-classifythreadarguments

test.each([
  [
    "call forwards its target contract",
    "function f(x: uint8): void {} f.call(undefined, \"x\");"
  ],
  [
    "binding a bad argument fails at binding",
    "function f(x:uint8):void{} const g=f.bind(undefined,\"x\");"
  ],
  [
    "invoking a bound callable retains the residual contract",
    "function f(x:uint8,y:string):void{} const g=f.bind(undefined,1);g(2);"
  ],
  [
    "apply reads positional array-like entries",
    "function f(x:uint8):void{}f.apply(undefined,{0:\"x\",length:1});"
  ],
  [
    "thread input is checked before launch",
    "function f(x: uint8): void {} f.callThread(\"x\");"
  ],
  [
    "thread empty bag is removed when the first parameter excludes it",
    "function f(x:uint8):void{}f.callThread({},\"x\");"
  ],
  [
    "function apply top",
    "function f(x:uint8):void{} f.apply(undefined,[\"x\"]);"
  ],
  [
    "function bind top",
    "function f(x:uint8):void{} const g=f.bind(undefined,\"x\"); g();"
  ],
  [
    "call ref decay",
    "function f(ref x:uint8):void{} let n:uint8=1; f.call(undefined,ref n);"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "function call ok",
    "function f(x: uint8): void {} f.call(undefined, 1);"
  ],
  [
    "function call mutated",
    "function f(x:uint8):void{} f.call=(x,y)=>0; f.call(undefined,\"x\");"
  ],
  [
    "call prototype replaced",
    "Function.prototype.call=function(...xs){return 1;}; function f(x:uint8):void{} f.call(undefined,\"x\");"
  ],
  [
    "callthread replaced",
    "function f(x:uint8):void{} f.callThread=(...xs)=>0; f.callThread(\"x\");"
  ],
  [
    "callthread first object is argument",
    "function f(x:{a?:uint8}):string{return \"argument\";} f.callThread({}).then(x=>{globalThis.__observation=x;});"
  ],
  [
    "bind may leave required arguments for later",
    "function f(x:uint8,y:string):void{}const g=f.bind(undefined,1);g(\"s\");"
  ],
  [
    "bind without fixed arguments",
    "function f(x:uint8):void{}const g=f.bind(undefined);g(1);"
  ],
  [
    "apply uses array-like positions without iteration",
    "function f(x:uint8):void{}f.apply(undefined,{0:1,length:1});"
  ],
  [
    "valid thread input",
    "function f(x:uint8):void{}f.callThread(1);"
  ],
  [
    "valid thread empty bag",
    "function f(x:uint8):void{}f.callThread({},1);"
  ],
  [
    "later calls keep runtime selection",
    "function f(x:uint8):void{}function unused(){f.call(undefined,\"x\");}"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  ['prior method replacement', 'Function.prototype.call=function(){return 1;};', 'function f(x:uint8):void{}f.call(undefined,"x");"ok";'],
  ['prior method getter', 'Object.defineProperty(Function.prototype,"call",{get(){return function(){return 1;};}});', 'function f(x:uint8):void{}f.call(undefined,"x");"ok";'],
  ['prior thread replacement', 'Function.prototype.callThread=function(){return 1;};', 'function f(x:uint8):void{}f.callThread("x");"ok";'],
])('%s remains dynamic', (_name, setup, source) => {
  expect(evaluatedSequence([setup, source])).toBe('ok');
});

test.each([
  ['rest binding retains its dynamic residual mapping', 'function f(...xs:[uint8,string]):void{}const g=f.bind(undefined,1);g("s");'],
  ['generic binding retains its dynamic specialization', 'function f<T:type>(x:uint8,y:T):void{}const g=f.bind(undefined,1);g("s");'],
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('an apply list with typed properties keeps their runtime boundaries', () => {
  expect(ok('function f(x:uint8):void{}try{f.apply(undefined,{(0:any):"s",length:1});}catch{}')).toBe(true);
});

test('overloaded binding retains ordinary eventual selection', () => {
  expect(ok('function f(x:uint8,y:string):void{}function f(x:string,y:uint8):void{}const g=f.bind(undefined,1);g("s");')).toBe(true);
});
