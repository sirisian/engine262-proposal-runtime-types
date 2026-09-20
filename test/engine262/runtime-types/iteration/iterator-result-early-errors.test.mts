import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok, settledAfterJobs } from '../harness.mts';

test.each([
  [
    "hook return unused",
    "function unused(x:{[Symbol.iterator]:()=>number}){for(const v of x){}}"
  ],
  [
    "hook return executed",
    "function unused(x:{[Symbol.iterator]:()=>number}){for(const v of x){}} unused({[Symbol.iterator]():number{return 1;}});"
  ],
  [
    "next member unused",
    "function unused(x:{[Symbol.iterator]:()=>{next:number}}){for(const v of x){}}"
  ],
  [
    "next member executed",
    "function unused(x:{[Symbol.iterator]:()=>{next:number}}){for(const v of x){}} unused({[Symbol.iterator](){return {next:1};}});"
  ],
  [
    "step return unused",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>number}}){for(const v of x){}}"
  ],
  [
    "step return executed",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>number}}){for(const v of x){}} unused({[Symbol.iterator](){return {next():number{return 1;}};}});"
  ],
  [
    "array spread unused",
    "function unused(x:{[Symbol.iterator]:()=>number}){[...x];}"
  ],
  [
    "array spread executed",
    "function unused(x:{[Symbol.iterator]:()=>number}){[...x];} unused({[Symbol.iterator]():number{return 1;}});"
  ],
  [
    "array binding unused",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>number}}){const [v]=x;}"
  ],
  [
    "array binding executed",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>number}}){const [v]=x;} unused({[Symbol.iterator](){return {next():number{return 1;}};}});"
  ],
  [
    "empty still acquires",
    "function unused(x:{[Symbol.iterator]:()=>number}){const []=x;} unused({[Symbol.iterator]():number{return 1;}});"
  ],
  [
    "entry hook existing",
    "function unused(x:{[Symbol.iterator]:number}){for(const v of x){}}"
  ],
  [
    "async step unused",
    "async function unused(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<number,never>}}){for await(const v of x){}}"
  ],
  [
    "async step rejection",
    "async function unused(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<number,never>}}){for await(const v of x){}} unused({[Symbol.asyncIterator](){return {next:async function():Promise.<number,never>{return 1;}};}}).then(()=>globalThis.settled=\"normal\",e=>globalThis.settled=e.constructor.name);"
  ]
])('R28 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any runtime",
    "function unused(x:any){for(const v of x){}} unused({[Symbol.iterator](){return 1;}});"
  ]
])('R28 retains runtime failure: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "empty skips next",
    "function unused(x:{[Symbol.iterator]:()=>{next:number}}){const []=x;} unused({[Symbol.iterator](){return {next:1};}});"
  ],
  [
    "empty step object valid",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>{}}}){const [v]=x;} unused({[Symbol.iterator](){return {next(){return {};}};}});"
  ],
  [
    "valid structural",
    "function unused(x:{[Symbol.iterator]:()=>{next:()=>{done:boolean,value:number}}}){for(const v of x){}} unused({[Symbol.iterator](){return {next(){return {done:true,value:1};}};}});"
  ],
  [
    "open hook return",
    "function unused(x:{[Symbol.iterator]:()=>{}}){for(const v of x){}}"
  ],
  [
    "union hook return",
    "function unused(x:{[Symbol.iterator]:()=>(number|{next:()=>{done:boolean,value:number}})}){for(const v of x){}}"
  ]
])('R28 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "async valid",
    "async function unused(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:boolean,value:number},never>}}){for await(const v of x){}} unused({[Symbol.asyncIterator](){return {next:async function():Promise.<{done:boolean,value:number},never>{return {done:true,value:1};}};}}).then(()=>globalThis.settled=\"normal\",e=>globalThis.settled=e.constructor.name);",
    "normal"
  ]
])('R28 async result: %s', (_name, source, result) => {
  expect(settledAfterJobs(source)).toBe(result);
});

test.each([
  [
    "elision",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>number}}){const [,]=x;}"
  ],
  [
    "rest",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>number}}){const [...xs]=x;}"
  ],
  [
    "assignment",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>number}}){let v;[v]=x;}"
  ],
  [
    "yield delegate",
    "function* f(x:{[Symbol.iterator]:()=>{next:()=>number}}){yield* x;}"
  ],
  [
    "async delegate",
    "async function* f(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<number,never>}}){yield* x;}"
  ],
  [
    "specialized inherited return",
    "class B<T>{[Symbol.iterator]():T{throw 1;}}class C extends B.<number>{}function f(x:C){[...x];}"
  ],
  [
    "sync fallback raw scalar",
    "async function f(x:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>number}}){for await(const v of x){}}"
  ]
])('R28 boundary control (early): %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "empty assignment",
    "function f(x:{[Symbol.iterator]:()=>{next:number}}){[]=x;}f({[Symbol.iterator](){return {next:1};}});"
  ],
  [
    "open next",
    "function f(x:{[Symbol.iterator]:()=>{next:object}}){const [v]=x;}f({[Symbol.iterator](){return {next(){return {};}};}});"
  ],
  [
    "hook result not awaited",
    "async function f(x:{[Symbol.asyncIterator]:()=>Promise.<number,never>}){for await(const v of x){}}"
  ],
  [
    "sync step not awaited",
    "async function f(x:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>Promise.<number,never>}}){for await(const v of x){break;}}"
  ],
  [
    "step return unknown arm",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>number|object}}){const [v]=x;}"
  ],
  [
    "optional async valid sync",
    "async function f(x:{[Symbol.asyncIterator]?:()=>number,[Symbol.iterator]:()=>{next:()=>{}}}){for await(const v of x){break;}}"
  ],
  [
    "named spread",
    "function f(x:{[Symbol.iterator]:()=>number}){function g(){}g(...x);}"
  ],
  [
    "reference iteration",
    "function f(x:{[Symbol.iterator]:()=>number}){for(const ref v of x){}}"
  ]
])('R28 boundary control (ok): %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('overloaded protocol contracts retain a potentially valid return', () => {
  expect(ok('interface Hook{():number;(n:number):{next:()=>{}};}function f(x:{[Symbol.iterator]:Hook}){const [v]=x;}')).toBe(true);
  expect(ok('interface Next{():number;(n:number):{};}function f(x:{[Symbol.iterator]:()=>{next:Next}}){const [v]=x;}')).toBe(true);
});

test('every published overload result can establish an invalid protocol stage', () => {
  expectStaticTypeError('interface Hook{():number;(n:number):string;}function f(x:{[Symbol.iterator]:Hook}){const [v]=x;}');
  expectStaticTypeError('interface Next{():number;(n:number):string;}function f(x:{[Symbol.iterator]:()=>{next:Next}}){const [v]=x;}');
});

test('a real async hook result remains an unawaited Object', () => {
  expect(settledAfterJobs(`
    async function f(x:{[Symbol.asyncIterator]:()=>Promise.<number,never>}){for await(const v of x){}}
    f({[Symbol.asyncIterator](){return Promise.resolve(1);}})
      .then(()=>globalThis.settled="normal",e=>globalThis.settled=e.constructor.name);
  `)).toBe('TypeError');
});

test('async fallback checks the raw sync step Object without awaiting it', () => {
  expect(settledAfterJobs(`
    async function f(x:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>Promise.<number,never>}}){
      for await(const v of x){break;}
    }
    f({[Symbol.asyncIterator]:undefined,[Symbol.iterator](){return {next(){return Promise.resolve(1);}};}})
      .then(()=>globalThis.settled="normal",e=>globalThis.settled=e.constructor.name);
  `)).toBe('normal');
});
