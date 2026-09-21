import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok, settledAfterJobs } from '../harness.mts';

test("R46: required number unused", () => {
  expectStaticTypeError("function f(x:{[Symbol.dispose]:(n:number)=>void}){{using r:{[Symbol.dispose]:(n:number)=>void}=x;}}");
});

test("R46: required number executed", () => {
  expectStaticTypeError("function f(x:{[Symbol.dispose]:(n:number)=>void}){{using r:{[Symbol.dispose]:(n:number)=>void}=x;}}f({[Symbol.dispose](n:number):void{globalThis.hookRan=true;}});");
});

test("R46: nominal inherited unused", () => {
  expectStaticTypeError("class B{[Symbol.dispose](n:number):void{}}class C extends B{}function f(x:C){{using r:C=x;}}");
});

test("R46: nominal inherited executed", () => {
  expectStaticTypeError("class B{[Symbol.dispose](n:number):void{}}class C extends B{}function f(x:C){{using r:C=x;}}f(new C());");
});

test("R46: specialized unused", () => {
  expectStaticTypeError("class R<T>{[Symbol.dispose](n:T):void{}}function f(x:R.<number>){{using r:R.<number>=x;}}");
});

test("R46: specialized executed", () => {
  expectStaticTypeError("class R<T>{[Symbol.dispose](n:T):void{}}function f(x:R.<number>){{using r:R.<number>=x;}}f(new R.<number>());");
});

test("R46: required ref unused", () => {
  expectStaticTypeError("class R{[Symbol.dispose](ref n:number):void{}}function f(x:R){{using r:R=x;}}");
});

test("R46: required ref executed", () => {
  expectStaticTypeError("class R{[Symbol.dispose](ref n:number):void{}}function f(x:R){{using r:R=x;}}f(new R());");
});

test("R46: fixed rest unused", () => {
  expectStaticTypeError("class R{[Symbol.dispose](...n:[1].<number>):void{}}function f(x:R){{using r:R=x;}}");
});

test("R46: fixed rest executed", () => {
  expectStaticTypeError("class R{[Symbol.dispose](...n:[1].<number>):void{}}function f(x:R){{using r:R=x;}}f(new R());");
});

test("R46: optional", () => {
  expect(ok("class R{[Symbol.dispose](n?:number):void{globalThis.hookRan=true;}}{using r:R=new R();}")).toBe(true);
});

test("R46: default", () => {
  expect(ok("class R{[Symbol.dispose](n:number=1):void{globalThis.hookRan=true;}}{using r:R=new R();}")).toBe(true);
});

test("R46: undefined admitted", () => {
  expect(ok("class R{[Symbol.dispose](n:number|undefined):void{globalThis.hookRan=true;}}{using r:R=new R();}")).toBe(true);
});

test("R46: empty rest", () => {
  expect(ok("class R{[Symbol.dispose](...n:[].<number>):void{globalThis.hookRan=true;}}{using r:R=new R();}")).toBe(true);
});

test("R46: ignored numeric result", () => {
  expect(ok("class R{[Symbol.dispose]():number{globalThis.hookRan=true;return 1;}}{using r:R=new R();}")).toBe(true);
});

test("R46: nullish viable", () => {
  expect(ok("function f(x:null|{[Symbol.dispose]:(n:number)=>void}){{using r:null|{[Symbol.dispose]:(n:number)=>void}=x;}}f(null);")).toBe(true);
});

test("R46: unknown type", () => {
  expect(ok("function f<T>(x:{[Symbol.dispose]:(n:T)=>void}){{using r:{[Symbol.dispose]:(n:T)=>void}=x;}}")).toBe(true);
});

test("R46: known viable overload", () => {
  expect(ok("function f(x:{[Symbol.dispose]:{(n:number):void;():void}}){{using r:{[Symbol.dispose]:{(n:number):void;():void}}=x;}}")).toBe(true);
});

test("R46: any boundary", () => {
  expectThrownKind("function f(x:any){{using r:any=x;}}f({[Symbol.dispose](n:number):void{}});", 'TypeError');
});

test("R46: existing noncallable check", () => {
  expectStaticTypeError("function f(x:{[Symbol.dispose]:number}){{using r:{[Symbol.dispose]:number}=x;}}");
});

test("R46: all invalid overloads", () => {
  expectStaticTypeError("class R{[Symbol.dispose](n:number):void{} [Symbol.dispose](n:boolean):void{}} function f(x:R){using r:R=x;}");
});

test("R46: getter declared bad signature", () => {
  expectStaticTypeError("class R{get [Symbol.dispose]():(n:number)=>void {globalThis.hookRan=true;return (n:number)=>{};}}function f(x:R){using r:R=x;}");
});

test("R46: optional hook is still required callable", () => {
  expectStaticTypeError("function f(x:{[Symbol.dispose]?: (n:number)=>void}){using r:{[Symbol.dispose]?: (n:number)=>void}=x;}");
});

test("R46: viable callable union", () => {
  expect(ok("function f(x:{[Symbol.dispose]:((n:number)=>void)|(()=>void)}){using r:{[Symbol.dispose]:((n:number)=>void)|(()=>void)}=x;}")).toBe(true);
});

test("R46: cleanup runs once after abrupt block exit", () => {
  expect(evaluated("let log=\"\"; function f(){using r:{[Symbol.dispose]:()=>void}={[Symbol.dispose](){log+=\"d\";}};log+=\"b\";throw 1;}try{f();}catch(e){log+=\"c\";}log;")).toBe("bdc");
});

test("R46: static disposal check never reads a getter", () => {
  expect(evaluated("let reads=0;class R{get [Symbol.dispose]():()=>void {reads++;return ()=>{};}}function f(x:R){using r:R=x;}String(reads);")).toBe("0");
});

test('function-scope resources dispose in reverse order on normal exit', () => {
  expect(evaluated('let log="";function f(){using a={[Symbol.dispose](){log+="a";}};using b={[Symbol.dispose](){log+="b";}};log+="f";}f();log;')).toBe('fba');
});

test('a return preserves its value and disposes before the caller resumes', () => {
  expect(evaluated('let log="";function f():string{using r={[Symbol.dispose](){log+="d";}};return "value";}const value=f();log+=value;log;')).toBe('dvalue');
});

test('arrow and method bodies own their resources', () => {
  expect(evaluated('let log="";const f=()=>{using r={[Symbol.dispose](){log+="a";}};};const o={m(){using r={[Symbol.dispose](){log+="m";}};}};f();o.m();log;')).toBe('am');
});

test('nested block and function resources dispose exactly once', () => {
  expect(evaluated('let log="";function f(){using a={[Symbol.dispose](){log+="a";}};{using b={[Symbol.dispose](){log+="b";}};}log+="f";}f();log;')).toBe('bfa');
});

test('generator suspension keeps resources until return closes the body', () => {
  expect(evaluated('let log="";function* f(){using r={[Symbol.dispose](){log+="d";}};yield 1;log+="x";}const it=f();it.next();const before=log;it.return();before+":"+log;')).toBe(':d');
});

test('async functions dispose before settling', () => {
  expect(settledAfterJobs('let log="";async function f(){using r={[Symbol.dispose](){log+="d";}};await 0;log+="b";}f().then(()=>{globalThis.settled=log;});')).toBe('bd');
});

test('a throwing disposer changes a normal function completion', () => {
  expectThrownKind('function f(){using r={[Symbol.dispose](){throw new TypeError("cleanup");}};}f();', 'TypeError');
});
