import { expect, test } from 'vitest';
import { observeProtocol } from '../observe-protocol.mts';

test.each([
  {
    "name": "real async delegated value unused",
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
    "name": "real async delegated value rejects",
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
    "name": "required callback prefix gap",
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
    "name": "reference callback boundary",
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
    "name": "known object then result ignored",
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
    "name": "terminal value not yielded",
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
    "name": "unknown done keeps reachability dynamic",
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
    "name": "for await does not separately await real async value",
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
    "name": "sync yield delegation does not assimilate",
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
    "name": "plain async yield already rejects",
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
    "name": "async from sync value already rejects",
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
    "name": "noncallable then is valid value",
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
    "name": "valid then accepts callable objects",
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
    "name": "unknown value type defers",
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
    "name": "terminal return explicitly awaits bad value",
    "source": "type Bad={then:(a:uint8,b:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:true,value:Bad}}};async function* f(it:It):AsyncGenerator.<any,any,void>{return yield* it;}",
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
    "name": "unannotated delegation retains raw value",
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
    "name": "viable terminal alternative prevents proof",
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
    "name": "valid resolving then executes",
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
    "name": "contextual generator contract",
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
    "name": "async generator method",
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
    "name": "a concrete delegated value cannot satisfy an arbitrary yield type",
    "source": "type Bad={then:(resolve:uint8,reject:uint8)=>void};type It={[Symbol.asyncIterator]:()=>{next:()=>{done:false,value:Bad}}};async function* f<T: type>(it:It):AsyncGenerator.<T,void,void>{yield* it;}",
    "expected": {
      "completion": "throw",
      "bodyRan": "false",
      "kind": "StaticTypeError",
      "settled": "unobserved",
      "hookRan": "false",
      "imports": []
    }
  }
])('$name', ({ source, expected }) => {
  expect(observeProtocol(source)).toMatchObject(expected);
});


test('an unknown delegated value remains dynamic at a generic yield boundary', () => {
  expect(observeProtocol('async function* f<T: type>(it: any): AsyncGenerator.<T, void, void> { yield* it; }')).toMatchObject({
    completion: 'normal', bodyRan: 'true', kind: null, settled: 'unobserved', hookRan: 'false', imports: [],
  });
});
