import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok, settledAfterJobs } from '../harness.mts';

test.each([
  "function required(x:uint8):void {} const f:(x?:uint8)=>void=required;",
  "function take(f:(x?:uint8)=>void){} function required(x:uint8):void {} take(required);",
  "function required(x:uint8):void {} function give():(x?:uint8)=>void { return required; }",
  "const f:(x?:uint8)=>void = (x:uint8):void=>{};",
  "interface I { m(x?:uint8): void; } class C implements I { m(x:uint8):void { let n:uint8=x; } } let c:I=new C(); c.m();"
])("function substitution respects omission: %s", (source) => expectStaticTypeError(source));

test.each([
  "function unused(o: {[x: string]: uint8}, k: \"x\" | \"y\") { let s: string = o[k]; }",
  "function f(o:{[key:symbol]:uint8}){let s:string=o[Symbol.iterator];}",
  "function f(o:{[key:string]:uint8}|{[key:string]:boolean}){let s:string=o[\"a\"];}"
])("finite index reads retain declared contracts: %s", (source) => expectStaticTypeError(source));

test.each([
  "function f(it:{[Symbol.iterator]:()=>Generator.<string,void,void>}) { for(let x:uint8 of it){} }",
  "function f(it:{[Symbol.iterator]:()=>Generator.<string,void,void>}) { for(let x of it) { let n:uint8=x; } }",
  "function f(it:{[Symbol.iterator]:()=>{next:()=>{done:false,value:string}}}){for(const x:uint8 of it){}}",
  "function f(it:{[Symbol.iterator]:()=>Generator.<string,void,void>}|{[Symbol.iterator]:()=>Generator.<boolean,void,void>}){for(const x:uint8 of it){}}"
])("structural iterables type loop bindings: %s", (source) => expectStaticTypeError(source));

test.each([
  "function f() { class C { constructor(x:uint8){} constructor(x:uint8,y:string=\"s\"){} } }",
  "class C { constructor(x:uint8){} constructor(x:uint8,y:string=\"s\"){} }",
  "function unused(){class C { constructor(x:uint8){} constructor(x:uint8,y?:string){} }}",
  "function unused(){class C{constructor(x:uint8,y:string){}constructor(x:uint8,y:string,z:boolean=true){}}}"
])("constructor declaration ambiguity includes omitted arguments: %s", (source) => expectStaticTypeError(source));

test.each([
  "function unused() { interface I{x:uint8;} class C implements I{readonly x:uint8=1;} }",
  "function unused() { interface I{x:uint8;} class C implements I{get x():uint8{return 1;}} }",
  "interface I{x:uint8;}class B{readonly x:uint8=1;}class C extends B implements I{}"
])("interface properties require write capability: %s", (source) => expectStaticTypeError(source));

test.each([
  "function f() { const o={get x():string {return \"s\";},set x(v:uint8){}}; }",
  "const o={get x():string{return \"s\";},set x(v:uint8){}};",
  "function unused(){const o={set x(v:uint8){},get x():string{return \"s\";}};}",
  "function unused(){const o={get [Symbol.iterator]():string{return \"s\";},set [Symbol.iterator](v:uint8){}};}"
])("effective object accessor pairs accept their read results: %s", (source) => expectStaticTypeError(source));

test.each([
  "function unused() { enum E: string { A } }",
  "function f() { enum E:boolean { A } }",
  "type S=string; function f() { enum E:S { A } }"
])("non-numeric enums require an initial value in every scope: %s", (source) => expectStaticTypeError(source));

test.each([
  "function unused(m:boolean32x4){let n:uint8=m.any();}",
  "function unused(m:boolean32x4){let n:uint8=m.all();}",
  "function unused(m:boolean32x4){m.select(\"s\", \"t\");}",
  "function unused(m:boolean32x4,a:float32x4,b:float32x4){let s:string=m.select(a,b);}",
  "function unused(m:boolean32x4){let n:uint8=m.any;}",
  "type M=boolean32x4;function unused(v:M){let s:string=v.all();}"
])("mask methods expose callable contracts: %s", (source) => expectStaticTypeError(source));

test.each([
  "const Target:uint8=1;function unused(){partial class Target{m(){}}}",
  "function Target(x:uint8):void{}function unused(){partial class Target{m(){}}}",
  "function unused(){type Target=uint8;partial class Target{m(){}}}",
  "type C=uint8; partial class C{m(){}}"
])("partial declarations resolve lexical targets: %s", (source) => expectStaticTypeError(source));

test.each([
  "function unused() { new Promise.<uint8>((resolve, reject) => { resolve(\"s\"); }); }",
  "function f() { new Promise.<uint8>((resolve:uint8)=>{}); }",
  "function unused(){new Promise.<uint8,string>((resolve,reject)=>{reject((1:=uint8));});}",
  "function unused(){new Promise.<uint8>((resolve)=>{let x:uint8=resolve;});}",
  "function unused(){new Promise.<uint8>((resolve)=>{function inner(x:string){resolve(x);} });}"
])("Promise executors adopt resolving capabilities: %s", (source) => expectStaticTypeError(source));

test.each([
  [
    "optional function good",
    "function optional(x?:uint8):string{return typeof x;} const f:(x?:uint8)=>string=optional; f();"
  ],
  [
    "optional default good",
    "function defaulted(x:uint8=1):string{return typeof x;} const f:(x?:uint8)=>string=defaulted; f();"
  ],
  [
    "optional undefined good",
    "function accepts(x:uint8|undefined):string{return typeof x;} const f:(x?:uint8)=>string=accepts; f();"
  ],
  [
    "optional target default",
    "function required(x:uint8):string{return typeof x;}const f:(x:uint8=1)=>string=required;f();"
  ],
  [
    "optional wider source",
    "function f(x?:uint8):void{}const g:(x:uint8)=>void=f;g(1);"
  ],
  [
    "index read valid",
    "function f(o:{[key:string]:uint8},k:\"a\"|\"b\"):uint8{return o[k];}String(f({a:1,b:2},\"a\"));"
  ],
  [
    "index read any",
    "function f(o:{[key:string]:any},k:string){let s:string=o[k];}"
  ],
  [
    "index named override",
    "function f(o:{a:string,[key:string]:uint8}){let s:string=o[\"a\"];}f({a:\"s\"});"
  ],
  [
    "broad index read",
    "function f(o:{[x:string]:uint8}, k:string) { let s:string=o[k]; }"
  ],
  [
    "index symbol read",
    "function f(o:{[x:symbol]:uint8}, k:symbol) { let s:string=o[k]; }"
  ],
  [
    "index read uint32",
    "function f(o:{[key:uint32]:uint8},k:uint32){let s:string=o[k];}"
  ],
  [
    "forof valid",
    "function* g():string{yield \"s\";}const it:{[Symbol.iterator]:()=>Generator.<string,void,void>}={[Symbol.iterator]:g};let out=\"\";for(const x:string of it){out=x;}out;"
  ],
  [
    "forof any",
    "function f(it:any){for(const x:uint8 of it){}}"
  ],
  [
    "forof nocalls",
    "let hits=0;const it={*[Symbol.iterator]():string{hits++;yield \"s\";}};function unused(){for(const x:string of it){}}String(hits);"
  ],
  [
    "constructor ambiguity good",
    "class C { constructor(x:uint8){} constructor(x:string){} } new C(1); \"ok\";"
  ],
  [
    "constructor ambiguity fixed rest",
    "class C { constructor(x:uint8){} constructor(...xs:[].<uint8>){} } new C(1); \"ok\";"
  ],
  [
    "constructor no overload",
    "class C{constructor(x:uint8,y:string=\"s\"){}}new C(1);\"ok\";"
  ],
  [
    "readonly implements good",
    "interface I{readonly x:uint8;} class C implements I{readonly x:uint8=1;} const c:I=new C(); String(c.x);"
  ],
  [
    "implements writable good",
    "interface I{x:uint8;}class C implements I{x:uint8=1;}let c:I=new C();c.x=2;String(c.x);"
  ],
  [
    "implements readonly covariance",
    "interface I{readonly x:number;}class C implements I{readonly x:1=1;}const c:I=new C();String(c.x);"
  ],
  [
    "object accessor good",
    "let saved:string=\"\"; const o={get x():string{return saved;},set x(v:string){saved=v;}}; o.x=\"s\";o.x;"
  ],
  [
    "object accessor wider",
    "const o={get x():string{return \"s\";},set x(v:string|uint8){}}; o.x;"
  ],
  [
    "object accessor any",
    "const o={get x():any{return \"s\";},set x(v:uint8){}};"
  ],
  [
    "object accessor shadowed",
    "const o={get x():string{return \"s\";},set x(v:uint8){},x:1};String(o.x);"
  ],
  [
    "object accessor noeffects",
    "let n=0;const o={get x():string{n++;return \"s\";},set x(v:string){n++;}};String(n);"
  ],
  [
    "enum numeric good",
    "function f(){enum E:uint8{A,B}return String(E.B);} f();"
  ],
  [
    "enum explicit good",
    "function f(){enum E:string{A=\"a\",B}return E.B;} f();"
  ],
  [
    "enum empty",
    "enum E:string {}"
  ],
  [
    "enum any",
    "function f(){enum E:any{A}}"
  ],
  [
    "enum function generic",
    "function f<T:type>(){enum E:T{A}}"
  ],
  [
    "enum local default numeric",
    "function unused(){enum E{A,B}}"
  ],
  [
    "vector mask good",
    "const m:boolean32x4=float32x4(1,2,3,4)<float32x4(4,3,2,1);let n:boolean=m.any();String(n);"
  ],
  [
    "vector select good",
    "const m:boolean32x4=float32x4(1,2,3,4)<float32x4(4,3,2,1);const v=m.select(float32x4(1,1,1,1),float32x4(2,2,2,2));String(v.x);"
  ],
  [
    "vector any any",
    "function unused(v:any){let n:uint8=v.any();}"
  ],
  [
    "vector lane good",
    "const v=float32x4(1,2,3,4);let n:float32=v.lane.<0>();String(n);"
  ],
  [
    "partial outer good",
    "class Target{x:uint8=1;}function f(){partial class Target{m():uint8{return this.x;}}}f();String(new Target().m());"
  ],
  [
    "partial shadow good",
    "const Target:uint8=1;function f(){class Target{x:uint8=1;}partial class Target{m():uint8{return this.x;}}return String(new Target().m());}f();"
  ],
  [
    "partial alias class",
    "class C{x:uint8=1;}const Target=C;function f(){partial class Target{m():uint8{return this.x;}}}f();String(new C().m());"
  ],
  [
    "partial dynamic",
    "function f(C:any){partial class C{m(){}}}"
  ],
  [
    "promise good settled",
    "new Promise.<uint8>((resolve)=>resolve(1)).then(x=>{globalThis.__observation=String(x);});"
  ],
  [
    "promise thenable good",
    "new Promise.<uint8>((resolve)=>resolve({then(done){done(1);}})).then((x:any)=>{globalThis.__observation=String(x);});"
  ],
  [
    "promise shadow",
    "function Promise(executor:any){}function unused(){new Promise((resolve)=>resolve(\"s\"));}"
  ],
  [
    "promise any parameter",
    "function unused(){new Promise.<uint8>((resolve:any)=>resolve(\"s\"));}"
  ],
  [
    "promise effects",
    "let n=0;function unused(){new Promise.<uint8>((resolve)=>{n++;resolve(1);});}String(n);"
  ]
])("valid contract: %s", (_name, source) => expect(ok(source)).toBe(true));

test("declared defaults are applied through a function crossing", () => {
  expect(evaluated("function required(x:uint8):string{return typeof x;}const f:(x:uint8=1)=>string=required;f();")).toBe("number");
});

test.each([
  'const value: any = "s"; new Promise.<uint8>((resolve: any) => resolve(value))',
  'new Promise.<uint8>((resolve: any) => resolve({ then(done) { done("s"); } }))',
  'new Promise.<uint8>((resolve: any) => resolve(Promise.resolve("s")))',
  'new Promise.<uint8, uint8>((resolve, reject: any) => reject("s"))',
])('typed Promise boundaries reject incompatible dynamic values: %s', (expression) => {
  expect(settledAfterJobs(`globalThis.settled = 'pending'; ${expression}.then(
    (value: any) => { globalThis.settled = 'fulfilled'; },
    (error: any) => { globalThis.settled = error.constructor.name; }
  );`)).toBe('TypeError');
});

test.each([
  'new Promise.<uint8>((resolve) => resolve(1))',
  'new Promise.<uint8>((resolve) => resolve({ then(done) { done(1); } }))',
  'new Promise.<uint8>((resolve) => resolve(Promise.resolve(1)))',
])('typed Promise assimilation converts the eventual value: %s', (expression) => {
  expect(settledAfterJobs(`globalThis.settled = 'pending'; ${expression}.then(
    (value: any) => { globalThis.settled = String(Reflect.typeOf(value) === uint8); },
    (error: any) => { globalThis.settled = error.constructor.name; }
  );`)).toBe('true');
});

test('typed Promise capabilities retain single settlement and void fulfillment', () => {
  expect(settledAfterJobs(`globalThis.settled = 'pending';
    new Promise.<uint8>((resolve: any, reject: any) => { resolve(1); reject('s'); resolve('s'); }).then(
      (value: any) => { globalThis.settled = String(value); }
    );`)).toBe('1');
  expect(settledAfterJobs(`globalThis.settled = 'pending';
    new Promise.<void>((resolve) => resolve()).then(
      (value: any) => { globalThis.settled = typeof value; }
    );`)).toBe('undefined');
});

test('typed Promise construction captures the actual intrinsic and preserves shadowing', () => {
  expect(evaluated(`class Replacement<T: type> { constructor(executor) { executor(() => {}); } }
    Promise = Replacement;
    new Promise.<uint8>((resolve) => resolve('s'));
    'ok';`)).toBe('ok');
  expect(evaluated(`function f(Promise: any) {
    new Promise.<uint8>((resolve) => resolve('s'));
  } 'ok';`)).toBe('ok');
  expect(evaluated(`const p = new Promise.<uint8>(() => {});
    String(Reflect.typeOf(p) === type Promise.<uint8>);`)).toBe('true');
});

test('finite key joins preserve named exceptions and unknown alternatives', () => {
  expect(ok(`function f(o: { name: string; [key: string]: uint8 }, key: 'name' | 'x') {
    let value: string | uint8 = o[key];
  }`)).toBe(true);
  expectStaticTypeError(`function f(o: { name: string; [key: string]: uint8 }, key: 'name' | 'x') {
    let value: uint8 = o[key];
  }`);
  expect(ok(`function f(o: { x: uint8; [key: symbol]: string }, key: 'x' | 'unknown') {
    let value: boolean = o[key];
  }`)).toBe(true);
});

test('effective object descriptors do not combine accessor halves across data replacements', () => {
  expect(ok(`const o = { get x(): string { return 's'; }, x: 1, set x(v: uint8) {} };`)).toBe(true);
  expectStaticTypeError(`function value(): string { return 's'; }
    const o = { get x() { return value(); }, set x(v: uint8) {} };`);
});

test('function omission checks retain defaults and undefined within rest contracts', () => {
  expectStaticTypeError(`function required(x: uint8): void {}
    const f: (...args: [].<uint8>) => void = required;`);
  expect(ok(`function optional(x: uint8 = 1): void {}
    const f: (...args: [].<uint8>) => void = optional; f();`)).toBe(true);
  expect(ok(`function optional(...args: [].<uint8 | undefined>): void {}
    const f: (x?: uint8) => void = optional; f();`)).toBe(true);
  expectStaticTypeError(`function required(a: string = 's', b: uint8): void {}
    const f: (a: string) => void = required;`);
});

test('contextual Promise construction retains its settlement boundary', () => {
  expect(settledAfterJobs(`globalThis.settled = 'pending';
    const promise: Promise.<uint8> = new Promise((resolve: any) => resolve('s'));
    promise.then((value: any) => { globalThis.settled = 'fulfilled'; },
      (error: any) => { globalThis.settled = error.constructor.name; });`)).toBe('TypeError');
});

test('typed Promise capabilities retain their contract after the executor returns', () => {
  expect(settledAfterJobs(`globalThis.settled = 'pending'; let resolveLater: any;
    const promise = new Promise.<uint8>((resolve: any) => { resolveLater = resolve; });
    promise.then((value: any) => { globalThis.settled = 'fulfilled'; },
      (error: any) => { globalThis.settled = error.constructor.name; });
    resolveLater('s');`)).toBe('TypeError');
});

test('untyped Promise construction and assimilation retain base language behavior', () => {
  expect(settledAfterJobs(`globalThis.settled = 'pending';
    new Promise((resolve) => resolve({ then(done) { done('s'); done(1); } })).then(
      (value) => { globalThis.settled = value; });`)).toBe('s');
});
