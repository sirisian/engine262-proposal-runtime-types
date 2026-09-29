import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

test("async return unused", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:number,reject:number)=>void}){return x;}");
});

test("async return executed", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:number,reject:number)=>void}){return x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);");
});

test("concise async arrow unused", () => {
  expectStaticTypeError("type Bad={then:(resolve:number,reject:number)=>void};const f=async (x:Bad)=>x;");
});

test("concise async arrow executed", () => {
  expectStaticTypeError("type Bad={then:(resolve:number,reject:number)=>void};const f=async (x:Bad)=>x;f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);");
});

test("async yield unused", () => {
  expectStaticTypeError("async function* f(x:{then:(resolve:number,reject:number)=>void}){yield x;}");
});

test("async yield executed", () => {
  expectStaticTypeError("async function* f(x:{then:(resolve:number,reject:number)=>void}){yield x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).next().then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);");
});

test("async generator return unused", () => {
  expectStaticTypeError("async function* f(x:{then:(resolve:number,reject:number)=>void}):AsyncGenerator.<any,any,void>{return x;}");
});

test("async generator return executed", () => {
  expectStaticTypeError("async function* f(x:{then:(resolve:number,reject:number)=>void}):AsyncGenerator.<any,any,void>{return x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).next().then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);");
});

test("typed async return unused", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:number,reject:number)=>void}):Promise.<any,any>{return x;}");
});

test("typed async return executed", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:number,reject:number)=>void}):Promise.<any,any>{return x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);");
});

test("valid resolving hook", () => {
  expect(settledAfterJobs("async function f(x:{then:(resolve:any,reject:any)=>void}):Promise.<any,any>{return x;}f({then(resolve:any,reject:any):void{resolve(1);}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);")).toBe("ok");
});

test("noncallable then is value", () => {
  expect(settledAfterJobs("async function f(x:{then:number}){return x;}f({then:1}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);")).toBe("ok");
});

test("viable union", () => {
  expect(settledAfterJobs("async function f(x:{then:(resolve:number,reject:number)=>void}|number){return x;}f(1).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);")).toBe("ok");
});

test("unknown generic", () => {
  expect(ok("async function f<T: type>(x:T){return x;}")).toBe(true);
});

test("sync return does not assimilate", () => {
  expect(ok("function f(x:{then:(resolve:number,reject:number)=>void}){return x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}});")).toBe(true);
});

test("sync yield does not assimilate", () => {
  expect(ok("function* f(x:{then:(resolve:number,reject:number)=>void}){yield x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).next();")).toBe(true);
});

test("any retains rejection", () => {
  expect(settledAfterJobs("async function f(x:any){return x;}f({then(resolve:number,reject:number):void{globalThis.hookRan=true;}}).then(()=>globalThis.settled=\"ok\",e=>globalThis.settled=e.constructor.name);")).toBe("TypeError");
});

test("explicit await already checked", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:number,reject:number)=>void}){await x;}");
});

test("async method return", () => {
  expectStaticTypeError("type Bad={then:(resolve:number,reject:number)=>void};class C { async f(x:Bad){return x;} }");
});

test("async block arrow return", () => {
  expectStaticTypeError("type Bad={then:(resolve:number,reject:number)=>void};const f=async (x:Bad)=>{return x;};");
});

test("required third assimilation slot", () => {
  expectStaticTypeError("async function f(x:{then:(resolve:any,reject:any,third:number)=>void}){return x;}");
});

test("reference resolving callback", () => {
  expectStaticTypeError("async function f(x:{then:(ref resolve:any,reject:any)=>void}){return x;}");
});

test("numeric callback rest", () => {
  expectStaticTypeError("async function f(x:{then:(...callbacks:[].<number>)=>void}){return x;}");
});

test("nested synchronous function return", () => {
  expect(ok("type Bad={then:(resolve:number,reject:number)=>void};async function f(x:Bad):Promise.<any,any>{function g(){return x;}return 1;}")).toBe(true);
});

test("nested synchronous generator yield", () => {
  expect(ok("type Bad={then:(resolve:number,reject:number)=>void};async function f(x:Bad):Promise.<any,any>{function* g(){yield x;}return 1;}")).toBe(true);
});

test("method normal result is ignored", () => {
  expect(settledAfterJobs("async function f(x:{then:(resolve:any,reject:any)=>number}):Promise.<any,any>{return x;}f({then(resolve:any,reject:any):number{resolve(\"ok\");return 42;}}).then(v=>globalThis.settled=v,e=>globalThis.settled=e.constructor.name);")).toBe("ok");
});

test("optional third slot does not reject", () => {
  expect(settledAfterJobs("async function f(x:{then:(resolve:any,reject:any,third?:number)=>void}):Promise.<any,any>{return x;}f({then(resolve:any,reject:any,third?:number):void{resolve(\"ok\");}}).then(v=>globalThis.settled=v,e=>globalThis.settled=e.constructor.name);")).toBe("ok");
});

test("primitive async concise result still settles", () => {
  expect(settledAfterJobs("const f=async ():Promise.<any,any>=>1;f().then(v=>globalThis.settled=String(v),e=>globalThis.settled=e.constructor.name);")).toBe("1");
});

test("synchronous generator preserves thenable object", () => {
  expect(evaluated("type Bad={then:(resolve:number,reject:number)=>void};let calls:number=0;function* f(x:Bad){yield x;}const x:Bad={then(resolve:number,reject:number):void{calls++;}};f(x).next();String(calls);")).toBe("0");
});
