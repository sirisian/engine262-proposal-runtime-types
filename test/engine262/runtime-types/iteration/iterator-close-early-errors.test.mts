import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok, settledAfterJobs } from '../harness.mts';

test.each([
  [
    "iterator close scalar",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:number}}){const []=x;}"
  ],
  [
    "iterator close scalar executed",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:number}}){const []=x;} f({[Symbol.iterator](){return {next:1,return:1};}});"
  ],
  [
    "iterator close scalar result",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:()=>number}}){const []=x;}"
  ],
  [
    "iterator close scalar result executed",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:()=>number}}){const []=x;} f({[Symbol.iterator](){return {next:1,return(){return 1;}};}});"
  ],
  [
    "control: empty assignment",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:()=>number}}){[]=x;}f({[Symbol.iterator](){return {next:1,return(){return 1;}};}});"
  ],
  [
    "edge: all invalid return union",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:number|string}}){const []=x;}f({[Symbol.iterator](){return {next:1,return:1};}});"
  ],
  [
    "async close unused",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:number},never>,return:()=>Promise.<number,never>}}){for await(const v of x){break;}}"
  ],
  [
    "async close rejects after awaiting return",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:number},never>,return:()=>Promise.<number,never>}}){for await(const v of x){break;}}f({[Symbol.asyncIterator](){return {next:async function(){return {done:false,value:1};},return:async function(){return 1;}};}}).then(()=>globalThis.settled=\"normal\",e=>globalThis.settled=e.constructor.name);"
  ]
])('R34 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "iterator close break executed",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:boolean,value:number},return:()=>number}}){for(const v of x){break;}} f({[Symbol.iterator](){return {next(){return {done:false,value:1};},return(){return 1;}};}});"
  ],
  [
    "control: any",
    "function f(x:any){const []=x;}f({[Symbol.iterator](){return {return(){return 1;}};}});"
  ],
  [
    "control: legacy",
    "const []={[Symbol.iterator](){return {return(){return 1;}};}};"
  ]
])('R34 preserves runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "iterator close break",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:boolean,value:number},return:()=>number}}){for(const v of x){break;}}"
  ],
  [
    "control: empty close null",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:null}}){const []=x;}f({[Symbol.iterator](){return {next:1,return:null};}});"
  ],
  [
    "control: empty close object",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:()=>{}}}){const []=x;}f({[Symbol.iterator](){return {next:1,return(){return {};}};}});"
  ],
  [
    "control: empty close Promise object",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:()=>Promise.<number,never>}}){const []=x;}f({[Symbol.iterator](){return {next:1,return(){return Promise.resolve(1);}};}});"
  ],
  [
    "control: already done",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:true,value:number},return:number}}){const [v]=x;}f({[Symbol.iterator](){return {next(){return {done:true,value:1};},return:1};}});"
  ],
  [
    "control: exhausting spread",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:true,value:number},return:number}}){[...x];}f({[Symbol.iterator](){return {next(){return {done:true,value:1};},return:1};}});"
  ],
  [
    "control: open return",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:object}}){const []=x;}"
  ],
  [
    "control: union return good",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:number|undefined}}){const []=x;}f({[Symbol.iterator](){return {next:1,return:undefined};}});"
  ],
  [
    "edge: throw masks close",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:false,value:number},return:()=>number}}){try{for(const v of x){throw \"original\";}}catch(e){if(e!==\"original\")throw e;}}f({[Symbol.iterator](){return {next(){return {done:false,value:1};},return(){return 1;}};}});"
  ],
  [
    "edge: throw masks noncallable close",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:false,value:number},return:number}}){try{for(const v of x){throw \"original\";}}catch(e){if(e!==\"original\")throw e;}}f({[Symbol.iterator](){return {next(){return {done:false,value:1};},return:1};}});"
  ],
  [
    "edge: unknown done break",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:boolean,value:number},return:number}}){for(const v of x){break;}}f({[Symbol.iterator](){return {next(){return {done:true,value:1};},return:1};}});"
  ]
])('R34 admits the control: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "async close Object succeeds",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:number},never>,return:()=>Promise.<{},never>}}){for await(const v of x){break;}}f({[Symbol.asyncIterator](){return {next:async function(){return {done:false,value:1};},return:async function(){return {};}};}}).then(()=>globalThis.settled=\"normal\",e=>globalThis.settled=e.constructor.name);",
    "normal"
  ]
])('R34 async control: %s', (_name, source, result) => {
  expect(settledAfterJobs(source)).toBe(result);
});

test.each([
  [
    "definitely yielding break",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:false,value:number},return:()=>number}}){for(const v of x){break;}}"
  ],
  [
    "nested empty blocks then break",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:false,value:number},return:number}}){for(const v of x){{;break;}}}"
  ],
  [
    "inherited specialized close",
    "class B<T: type>{[Symbol.iterator]():{next:number,return:()=>T}{throw 1;}}class C extends B.<number>{}function f(x:C){const []=x;}"
  ]
])('R34 additional early boundary: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unknown control flow preserves execution",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:boolean,value:number},return:number}},flag:boolean){for(const v of x){if(flag)break;}}f({[Symbol.iterator](){return {next(){return {done:true,value:1};},return:1};}},false);"
  ],
  [
    "optional return can be absent",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return?:()=>number}}){const []=x;}f({[Symbol.iterator](){return {next:1};}});"
  ],
  [
    "open return can be callable",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:object}}){const []=x;}f({[Symbol.iterator](){return {next:1,return(){return {};}};}});"
  ]
])('R34 additional ok boundary: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});
