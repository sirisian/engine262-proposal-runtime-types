import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

test.each([
  [
    "wrong callback parameters unused",
    "async function f(x:{then:(resolve:number,reject:number)=>void}){await x;}"
  ],
  [
    "wrong callback parameters executed",
    "async function f(x:{then:(resolve:number,reject:number)=>void}){await x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});"
  ],
  [
    "missing third required parameter unused",
    "async function f(x:{then:(resolve:any,reject:any,third:number)=>void}){await x;}"
  ],
  [
    "missing third required parameter executed",
    "async function f(x:{then:(resolve:any,reject:any,third:number)=>void}){await x;}f({then(resolve:any,reject:any,third:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});"
  ],
  [
    "incompatible rest unused",
    "async function f(x:{then:(...callbacks:[].<number>)=>void}){await x;}"
  ],
  [
    "incompatible rest executed",
    "async function f(x:{then:(...callbacks:[].<number>)=>void}){await x;}f({then(...callbacks:[].<number>):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});"
  ],
  [
    "required reference callback unused",
    "async function f(x:{then:(ref resolve:any,reject:any)=>void}){await x;}"
  ],
  [
    "required reference callback executed",
    "async function f(x:{then:(ref resolve:any,reject:any)=>void}){await x;}f({then(ref resolve:any,reject:any):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});"
  ]
])('R44 rejects before evaluation: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "working thenable",
    "async function f(x:{then:(resolve:any,reject:any)=>void}){await x;}f({then(resolve:any,reject:any):void{globalThis.hookRan=true;resolve(1);}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "noncallable then is successful value",
    "async function f(x:{then:number}){await x;}f({then:1}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "nullish then is successful value",
    "async function f(x:{then:null}){await x;}f({then:null}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "optional then keeps viable absence",
    "async function f(x:{then?:((resolve:number,reject:number)=>void)}){await x;}f({}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "return result is ignored",
    "async function f(x:{then:(resolve:any,reject:any)=>number}){await x;}f({then(resolve:any,reject:any):number{resolve(1);return 3;}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "default third slot",
    "async function f(x:{then:(resolve:any,reject:any,third?:number)=>void}){await x;}f({then(resolve:any,reject:any,third:number=0):void{resolve(1);}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "any runtime",
    "async function f(x:any){await x;}f({then(resolve:number,reject:number):void{}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "TypeError"
  ],
  [
    "ordinary promise",
    "async function f(x:Promise.<number,any>){await x;}f(Promise.resolve(1)).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "primitive await",
    "async function f(x:number){await x;}f(1).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "viable noncallable union",
    "async function f(x:{then:number|((resolve:number,reject:number)=>void)}){await x;}f({then:1}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ],
  [
    "open object remains unknown",
    "async function f(x:object){await x;}f({then(resolve,reject){resolve(1);}}).then(()=>globalThis.settled=\"ok\",e=>{globalThis.settled=e.constructor.name;globalThis.settledMessage=e.message;});",
    "ok"
  ]
])('R44 preserves settlement: %s', (_name, source, expected) => {
  expect(settledAfterJobs(source)).toBe(expected);
});

test.each([
  [
    "all invalid overloads",
    "async function f(x:{then:{(a:number):void;(a:string):void}}){await x;}"
  ],
  [
    "inherited method",
    "class B{then(a:number,b:number):void{}}class C extends B{}async function f(x:C){await x;}"
  ],
  [
    "specialized method",
    "class B<T>{then(a:T,b:T):void{}}async function f(x:B.<number>){await x;}"
  ],
  [
    "scalar callback union",
    "async function f(x:{then:(a:number|symbol,b:any)=>void}){await x;}"
  ],
  [
    "optional callback scalar",
    "async function f(x:{then:(a?:number,b?:number)=>void}){await x;}"
  ],
  [
    "fixed rest too long",
    "async function f(x:{then:(...args:[3].<any>)=>void}){await x;}"
  ],
  [
    "required after rest",
    "async function f(x:{then:(...args:[].<any>,tail:number)=>void}){await x;}"
  ],
  [
    "reference rest consumes callbacks",
    "async function f(x:{then:(ref ...args:[].<any>)=>void}){await x;}"
  ],
  [
    "return context",
    "async function f(x:{then:(a:number,b:number)=>void}){return await x;}"
  ],
  [
    "assignment context",
    "async function f(x:{then:(a:number,b:number)=>void}){const y=await x;}"
  ]
])('R44 rejects a proved edge case: %s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "viable overload",
    "async function f(x:{then:{(a:number):void;(a:any,b:any):void}}){await x;}"
  ],
  [
    "unknown callback signature",
    "async function f(x:{then:(a:()=>number,b:()=>string)=>void}){await x;}"
  ],
  [
    "unknown callback members",
    "async function f(x:{then:(a:{x:number},b:{y:string})=>void}){await x;}"
  ],
  [
    "generic callback contract",
    "async function f<T>(x:{then:(a:T,b:T)=>void}){await x;}"
  ],
  [
    "viable callback union",
    "async function f(x:{then:(a:number|((v:any)=>void),b:any)=>void}){await x;}"
  ],
  [
    "empty reference rest",
    "async function f(x:{then:(a:any,b:any,ref ...args:[].<any>)=>void}){await x;}"
  ],
  [
    "promise and thenable union",
    "async function f(x:Promise.<number,any>|{then:(a:number,b:number)=>void}){await x;}"
  ]
])('R44 accepts a viable edge case: %s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "native callbacks accepted as functions",
    "async function f(x:{then:(a:(v:any)=>void,b:(v:any)=>void)=>void}){await x;}f({then(a:(v:any)=>void,b:(v:any)=>void):void{a(1);}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "ok"
  ],
  [
    "callable callback can have inherited property",
    "Function.prototype.marker=1;async function f(x:{then:(a:{marker:number},b:any)=>void}){await x;}f({then(a:{marker:number},b:any):void{const resolve:any=a;resolve(1);}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);",
    "ok"
  ]
])('R44 accepts actual callback values: %s', (_name, source, expected) => {
  expect(settledAfterJobs(source)).toBe(expected);
});
