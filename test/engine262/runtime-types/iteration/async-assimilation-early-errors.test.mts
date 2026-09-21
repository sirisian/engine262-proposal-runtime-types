import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

// Preserve the error phase as well as the outcome and observable effects.
test.each([
  [
    "R58-01: async-next-unused",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-02: async-next-run",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({then:(x:uint8):void=>{}})})}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-03: async-fromsync-unused",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}}){for await(const x of xs){break;}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-04: async-fromsync-run",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}}){for await(const x of xs){break;}}f({[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>({next:()=>({done:false,value:{then:(x:uint8):void=>{}}})})}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-05: async-close-run",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:false},return:()=>Bad}}){for await(const x of xs){break;}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:false}),return:()=>({then:(x:uint8):void=>{}})})}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-06: async-delegate-run",
    "type Bad={then:(x:uint8)=>void};async function* f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad}}){yield* xs;}f({[Symbol.asyncIterator]:()=>({next:()=>({then:(x:uint8):void=>{}})})}).next().catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-07: async-next-control",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:true}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:true})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false"
    }
  ],
  [
    "R58-08: sync-value-noawait",
    "type Bad={then:(x:uint8)=>void};function f(xs:{[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}}){for(const x of xs){break;}}f({[Symbol.iterator]:()=>({next:()=>({done:false,value:{then:(x:uint8):void=>{}}})})});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false"
    }
  ],
  [
    "R58-09: async-value-noawait",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}}){for await(const x of xs){break;}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:false,value:{then:(x:uint8):void=>{}}})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false"
    }
  ],
  [
    "R58-10: async-entry-notawaited",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{then:(x:uint8)=>void,next:()=>{done:true}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({then:(x:uint8):void=>{},next:()=>({done:true})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false"
    }
  ],
  [
    "R58-11: close unused",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:false},return:()=>Bad}}){for await(const x of xs){break;}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-12: delegation unused",
    "type Bad={then:(x:uint8)=>void};async function* f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad}}){yield* xs;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-13: noncallable then accepted",
    "async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:true,then:uint8}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:true,then:1})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok"
    }
  ],
  [
    "R58-14: good thenable resolves step",
    "async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{then:(resolve:any,reject:any)=>void}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({then(resolve:any,reject:any):void{resolve({done:true});}})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok"
    }
  ],
  [
    "R58-15: primitive async step existing error",
    "async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>uint8}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-16: any iterator retains dynamic rejection",
    "type Bad={then:(x:uint8)=>void};async function f(xs:any){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({then:(x:uint8):void=>{}})})}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError"
    }
  ],
  [
    "R58-17: normal exhaustion never closes",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:true},return:()=>Bad}}){for await(const x of xs){break;}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:true}),return:()=>({then:(x:uint8):void=>{}})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok"
    }
  ],
  [
    "R58-18: sync fallback awaits done value too",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:true,value:Bad}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>({next:()=>({done:true,value:{then:(x:uint8):void=>{}}})})}).catch(e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-19: viable result union",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad|{done:true}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:true})})}).then(()=>{globalThis.settled=\"ok\";},e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok"
    }
  ],
  [
    "R58-20: sync iterator then is not assimilated",
    "type Bad={then:(x:uint8)=>void};function f(xs:{[Symbol.iterator]:()=>{next:()=>{done:true,then:(x:uint8)=>void}}}){for(const x of xs){}}f({[Symbol.iterator]:()=>({next:()=>({done:true,then:(x:uint8):void=>{}})})});",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R58-E01: next result mixed failure reasons",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad|uint8}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E02: next signatures mixed arguments and assimilation",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:{(n:uint8):{done:true};():Bad}}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E03: close result mixed failure reasons",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:false},return:()=>Bad|uint8}}){for await(const x of xs){break;}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E04: adapter mixed raw Object and value failures",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>uint8|{done:true,value:Bad}}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E05: adapter does not await raw step",
    "async function f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:true,value:uint8,then:(x:uint8)=>void}}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>({next:()=>({done:true,value:1,then:(x:uint8):void=>{globalThis.hookRan=true;}})})}).then(()=>globalThis.settled=\"ok\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false"
    }
  ],
  [
    "R58-E06: adapter delegation initial value",
    "type Bad={then:(x:uint8)=>void};async function* f(xs:{[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}}){yield* xs;}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E07: generic then specialization",
    "class Bad<T>{then(x:T):void{}}async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad.<uint8>}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E08: inherited then contract",
    "class B{then(x:uint8):void{}}class C extends B{}async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>C}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ],
  [
    "R58-E09: generic then unresolved",
    "class Bad<T>{then(x:T):void{}}async function f<T>(xs:{[Symbol.asyncIterator]:()=>{next:()=>Bad.<T>}}){for await(const x of xs){}}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R58-E10: viable then overload",
    "type P={then:{(x:uint8):void;(resolve:any,reject:any):void}};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>P}}){for await(const x of xs){}}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R58-E11: intrinsic Promise path",
    "async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>Promise.<{done:true},never>}}){for await(const x of xs){}}f({[Symbol.asyncIterator]:()=>({next:()=>Promise.resolve({done:true})})}).then(()=>globalThis.settled=\"ok\");",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok"
    }
  ],
  [
    "R58-E12: throw wins over close assimilation",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>{done:false},return:()=>Bad}}){for await(const x of xs){throw \"original\";}}f({[Symbol.asyncIterator]:()=>({next:()=>({done:false}),return:()=>({then:(x:uint8):void=>{globalThis.hookRan=true;}})})}).catch(e=>globalThis.settled=String(e));",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "original",
      "hookRan": "false"
    }
  ],
  [
    "R58-E13: mutable open next result checked at runtime",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>any}}){for await(const x of xs){}}const iterator={next:()=>({done:true})};iterator.next=()=>({then:(x:uint8):void=>{}});f({[Symbol.asyncIterator]:()=>iterator}).catch(e=>globalThis.settled=e.constructor.name);",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "TypeError"
    }
  ],
  [
    "R58-E14: async entry result is not awaited",
    "type Bad={then:(x:uint8)=>void};async function f(xs:{[Symbol.asyncIterator]:()=>Bad&{next:()=>{done:true}}}){for await(const x of xs){}}",
    {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null
    }
  ],
  [
    "R58-E15: generic getter then specialized",
    "class P<T>{get then():T{throw 0;}}async function f(xs:{[Symbol.asyncIterator]:()=>{next:()=>P.<(x:uint8)=>void>}}){for await(const x of xs){}}",
    {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  ]
])('%s', (_name, source, expected) => {
  expect(observeProtocol(source as string)).toMatchObject(expected);
});
