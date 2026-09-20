import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  [
    "entry arguments unused",
    "function f(x:{[Symbol.iterator]:(n:number)=>{next:()=>object}}){const []=x;}"
  ],
  [
    "entry arguments executed",
    "function f(x:{[Symbol.iterator]:(n:number)=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](n:number){return {next(){return {};}};}});"
  ],
  [
    "next arguments unused",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){const [v]=x;}"
  ],
  [
    "next arguments executed",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){const [v]=x;}f({[Symbol.iterator](){return {next(n:number){return {};}};}});"
  ],
  [
    "close arguments unused",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:(n:number)=>object}}){const []=x;}"
  ],
  [
    "close arguments executed",
    "function f(x:{[Symbol.iterator]:()=>{next:number,return:(n:number)=>object}}){const []=x;}f({[Symbol.iterator](){return {next:1,return(n:number){return {};}};}});"
  ],
  [
    "spread step unused",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){[...x];}"
  ],
  [
    "spread step executed",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){[...x];}f({[Symbol.iterator](){return {next(n:number){return {};}};}});"
  ],
  [
    "for-of step unused",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){for(const v of x){break;}}"
  ],
  [
    "for-of step executed",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){for(const v of x){break;}}f({[Symbol.iterator](){return {next(n:number){return {};}};}});"
  ],
  [
    "yield delegation initial next unused",
    "function* f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){yield* x;}"
  ],
  [
    "yield delegation initial next executed",
    "function* f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){yield* x;}f({[Symbol.iterator](){return {next(n:number){return {};}};}}).next();"
  ],
  [
    "async next unused",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:(n:number)=>Promise.<object,never>}}){for await(const v of x){break;}}"
  ],
  [
    "async next executed",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:(n:number)=>Promise.<object,never>}}){for await(const v of x){break;}}f({[Symbol.asyncIterator](){return {next(n:number){return Promise.resolve({done:true});}};}}).then(()=>globalThis.settled=\"normal\",e=>globalThis.settled=e.constructor.name);"
  ]
])('R38 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "any boundary",
    "function f(x:any){const []=x;}f({[Symbol.iterator](n:number){return {next(){return {};}};}});"
  ]
])('R38 retains runtime timing: %s', (_name, source) => {
  expectThrownKind(source, 'TypeError');
});

test.each([
  [
    "empty skips next",
    "function f(x:{[Symbol.iterator]:()=>{next:(n:number)=>object}}){const []=x;}f({[Symbol.iterator](){return {next(n:number){return {};}};}});"
  ],
  [
    "optional parameter",
    "function f(x:{[Symbol.iterator]:(n?:number)=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](n?:number){return {next(){return {};}};}});"
  ],
  [
    "undefined accepted",
    "function f(x:{[Symbol.iterator]:(n:undefined)=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](n:undefined){return {next(){return {};}};}});"
  ],
  [
    "default parameter",
    "class C{[Symbol.iterator](n:number=1):{next:()=>object}{return {next(){return {done:true};}};}}function f(x:C){const []=x;}f(new C());"
  ],
  [
    "exhaustion skips return",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:true},return:(n:number)=>object}}){for(const v of x){}}f({[Symbol.iterator](){return {next(){return {done:true};},return(n:number){return {};}};}});"
  ]
])('R38 preserves valid behavior: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "throw masks close failure",
    "function f(x:{[Symbol.iterator]:()=>{next:()=>{done:false,value:number},return:(n:number)=>object}}){for(const v of x){throw \"original\";}}try{f({[Symbol.iterator](){return {next(){return {done:false,value:1};},return(n:number){return {};}};}});}catch(e){globalThis.settled=e;}",
    "original"
  ]
])('R38 preserves values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

test.each([
  [
    "entry ref argument",
    "function f(x:{[Symbol.iterator]:(ref n:number)=>{next:()=>object}}){const []=x;}"
  ],
  [
    "entry fixed rest missing",
    "function f(x:{[Symbol.iterator]:(...xs:[1].<number>)=>{next:()=>object}}){const []=x;}"
  ],
  [
    "entry tuple rest missing",
    "function f(x:{[Symbol.iterator]:(...xs:[number])=>{next:()=>object}}){const []=x;}"
  ],
  [
    "multiple rests required tail",
    "function f(x:{[Symbol.iterator]:(...xs:[].<number>,...ys:[].<string>,flag:boolean)=>{next:()=>object}}){const []=x;}"
  ],
  [
    "non-final rest required tail",
    "function f(x:{[Symbol.iterator]:(...xs:[].<number>,flag:boolean)=>{next:()=>object}}){const []=x;}"
  ],
  [
    "yield initial undefined and number rest",
    "function* f(x:{[Symbol.iterator]:()=>{next:(...xs:[].<number>)=>object}}){yield* x;}"
  ],
  [
    "inherited method",
    "class B{[Symbol.iterator](n:number):{next:()=>object}{return {next(){return {};}};}}class C extends B{}function f(x:C){const []=x;}"
  ],
  [
    "generic specialization",
    "class C<T>{[Symbol.iterator](n:T):{next:()=>object}{return {next(){return {};}};}}function f(x:C.<number>){const []=x;}"
  ],
  [
    "all invalid overloads",
    "function f(x:{[Symbol.iterator]:{(n:number):{next:()=>object};(n:string):{next:()=>object}}}){const []=x;}"
  ],
  [
    "async entry",
    "async function f(x:{[Symbol.asyncIterator]:(n:number)=>{next:()=>object}}){for await(const v of x){break;}}"
  ],
  [
    "async close",
    "async function f(x:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:false,value:number},never>,return:(n:number)=>Promise.<object,never>}}){for await(const v of x){break;}}"
  ],
  [
    "sync fallback next",
    "async function f(x:{[Symbol.asyncIterator]:null,[Symbol.iterator]:()=>{next:(n:number)=>object}}){for await(const v of x){break;}}"
  ]
])('R38 additional early: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "loop zero args number rest",
    "function f(x:{[Symbol.iterator]:()=>{next:(...xs:[].<number>)=>object}}){for(const v of x){break;}}f({[Symbol.iterator](){return {next(...xs:[].<number>){return {done:true};}};}});"
  ],
  [
    "two empty rests",
    "function f(x:{[Symbol.iterator]:(...xs:[].<number>,...ys:[].<string>)=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](...xs:[].<number>,...ys:[].<string>){return {next(){return {};}};}});"
  ],
  [
    "ref empty rest",
    "function f(x:{[Symbol.iterator]:(ref ...xs:[].<number>)=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](ref ...xs:[].<number>){return {next(){return {};}};}});"
  ],
  [
    "unbound generic",
    "class C<T>{[Symbol.iterator](n:T):{next:()=>object}{return {next(){return {};}};}}function f<T>(x:C.<T>){const []=x;}"
  ],
  [
    "overload viable",
    "function f(x:{[Symbol.iterator]:{(n:number):{next:()=>object};():{next:()=>object}}}){const []=x;}"
  ]
])('R38 additional ok: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "getter not executed",
    "let reads=0;class C{get [Symbol.iterator]():()=>{next:()=>object}{reads++;return ()=>({next(){return {};}});}}function f(x:C){const []=x;}globalThis.settled=String(reads);",
    "0"
  ]
])('R38 additional values and effects: %s', (_name, source, expected) => {
  expect(evaluated(source + 'String(globalThis.settled);')).toBe(expected);
});

// A rest parameter may itself collect a tuple containing rest positions.
test.each([
  'function f(x:{[Symbol.iterator]:(...xs:[number,...[].<string>])=>{next:()=>object}}){const []=x;}',
  'function* f(x:{[Symbol.iterator]:()=>{next:(...xs:[number,...[].<string>])=>object}}){yield* x;}',
])('R38 checks required positions inside a tuple rest: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  'function f(x:{[Symbol.iterator]:(...xs:[...[].<string>])=>{next:()=>object}}){const []=x;}f({[Symbol.iterator](...xs:[...[].<string>]){return {next(){return {};}};}});',
  'function* f(x:{[Symbol.iterator]:()=>{next:(...xs:[undefined,...[].<string>])=>object}}){yield* x;}f({[Symbol.iterator](){return {next(...xs:[undefined,...[].<string>]){return {done:true};}};}}).next();',
])('R38 admits viable positions inside a tuple rest: %s', (source) => {
  expect(ok(source)).toBe(true);
});
