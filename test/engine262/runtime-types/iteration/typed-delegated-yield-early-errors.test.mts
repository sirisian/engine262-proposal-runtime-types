import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "R68-01: real async delegated value unused",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-02: real async delegated value rejects",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const bad:Bad={then(a:uint8,b:uint8){}};const it:It={[Symbol.asyncIterator](){return{next(){return{done:false,value:bad};}};}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}f(it).next().then(v=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-03: required callback prefix gap",
    "source": "type Bad={then:(a:any,b:any,n:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-04: reference callback boundary",
    "source": "type Bad={then:(ref a:object,b:any)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-05: known object then result ignored",
    "source": "type Bad={then:(a:uint8,b:uint8)=>object};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-06: terminal value not yielded",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:true,value:Bad}}};const bad:Bad={then(a:uint8,b:uint8){}};const it:It={[Symbol.asyncIterator](){return{next(){return{done:true,value:bad};}};}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}f(it).next().then(v=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-07: unknown done keeps reachability dynamic",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:boolean,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-08: for await does not separately await real async value",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const bad:Bad={then(a:uint8,b:uint8){}};const it:It={[Symbol.asyncIterator](){return{next(){return{done:false,value:bad};}};}};async function f(it:It){for await(const x of it){globalThis.settled=String(x===bad);break;}}f(it).catch(e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-09: sync yield delegation does not assimilate",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}};function* f(it:It):Generator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-10: plain async yield already rejects",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};async function* f(x:Bad):AsyncGenerator.<any,void,void>{yield x;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-11: async from sync value already rejects",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:undefined,[Symbol.iterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-12: noncallable then is valid value",
    "source": "type Bad={then:uint8};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const bad:Bad={then:uint8(1)};const it:It={[Symbol.asyncIterator](){return{next(){return{done:false,value:bad};}};}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}f(it).next().then(v=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-13: valid then accepts callable objects",
    "source": "type Bad={then:(a:object,b:object)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-14: unknown value type defers",
    "source": "type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:any}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-15: terminal return explicitly awaits bad value",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:true,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,any,void>{return yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-16: unannotated delegation retains raw value",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const bad:Bad={then(a:uint8,b:uint8){}};const it:It={[Symbol.asyncIterator](){return{next(){return{done:false,value:bad};}};}};async function* f(it:It){yield* it;}f(it).next().then(v=>globalThis.settled=String(v.value===bad),e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "true",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-17: viable terminal alternative prevents proof",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}|{done:true}}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-18: valid resolving then executes",
    "source": "type Bad={then:(a:any,b:any)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const bad:Bad={then(a:any,b:any){a(1);}};const it:It={[Symbol.asyncIterator](){return{next(){return{done:false,value:bad};}};}};async function* f(it:It):AsyncGenerator.<any,void,void>{yield* it;}f(it).next().then(v=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "ok",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-extra-01: contextual generator contract",
    "source": "type Bad={then:(resolve:uint8,reject:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};const f:(it:It)=>AsyncGenerator.<any,void,void>=async function*(it){yield* it;};",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-extra-02: async generator method",
    "source": "type Bad={then:(resolve:uint8,reject:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};class C{async *f(it:It):AsyncGenerator.<any,void,void>{yield* it;}}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  },
  {
    "name": "R68-extra-03: generic annotation remains dynamic",
    "source": "type Bad={then:(resolve:uint8,reject:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f<T: type>(it:It):AsyncGenerator.<T,void,void>{yield* it;}",
    "expected": {
      "completion": "normal",
      "bodyRan": "true",
      "kind": null,
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});
