import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-issignaturesubtype; #sec-declared-narrowing

test.each([
  [
    "reference permissions at a callable binding",
    "function f(ref x: uint8): void {} function unused() { let g: (x: uint8) => void = f; }"
  ],
  [
    "a value callback cannot promise a reference convention",
    "function f(x:uint8):void{} function unused(){let g:(ref x:uint8)=>void=f;}"
  ],
  [
    "a generic callback must satisfy its bound",
    "function f<T:type extends number>(x:T):T {return x;} function unused(){let g:(x:string)=>string=f;}"
  ],
  [
    "an override must preserve its predicate",
    "class A { check(v:uint8|string):v is uint8{return v is uint8;} } class B extends A {check(v:uint8|string):boolean{return true;}}"
  ],
  [
    "dependent callback constraints are substituted",
    "function f<T:type,U:type extends T>(a:T,b:U):U{return b;} function unused(){let g:(a:number,b:string)=>string=f;}"
  ],
  [
    "untyped reference declarations keep their permission",
    "function f(ref x){} function unused(){let g:(x:uint8)=>void=f;}"
  ],
  [
    "fixed reference rest positions remain references",
    "function f(ref ...xs:[uint8,uint8]):void{} function unused(){let g:(x:uint8,y:uint8)=>void=f;}"
  ],
  [
    "function ref covariant",
    "class A {} class D extends A {} function f(ref x: A): void {} function unused() { let g: (ref x: D) => void = f; }"
  ],
  [
    "implements ref strengthening",
    "interface I { m(x: uint8): void; } class C implements I { m(ref x: uint8): void {} }"
  ],
  [
    "override ref strengthening",
    "class A { m(x: uint8): void {} } class B extends A { m(ref x: uint8): void {} }"
  ],
  [
    "generic source object bound",
    "function f<T:type extends {x:uint8}>(x:T):T {return x;} function unused(){let g:(x:{y:string})=>{y:string}=f;}"
  ],
  [
    "generic nominal widened",
    "class A{} class D extends A{} function f<T:type extends D>(x:T):T{return x;} function unused(){let g:(x:A)=>A=f;}"
  ],
  [
    "generic narrower source",
    "function f<T:type extends 1>(x:T):T{return x;} function unused(){let g:<T:type extends number>(x:T)=>T=f;}"
  ],
  [
    "guard wrong override",
    "class A { check(v:uint8|string):v is uint8{return v is uint8;} } class B extends A {check(v:uint8|string):v is string{return v is string;}}"
  ],
  [
    "function predicate reflect",
    "function makeGuard(){return Reflect.makeType({kind:\"function\",signatures:[{parameters:[{name:\"v\",type:type any}],return:{type:type boolean},narrows:[{target:\"v\",type:type uint8}]}]});} type G=makeGuard(); function plain(v:any):boolean{return true;} const g:G=plain;"
  ],
  [
    "guard stronger boolean override",
    "class A { check(v:uint8|string|boolean):v is uint8|string{return !(v is boolean);} } class B extends A {check(v:uint8|string|boolean):v is uint8{return v is uint8;}}"
  ],
  [
    "guard runtime witness",
    "class A{check(v:uint8|string):v is uint8{return v is uint8;}} class B extends A{check(v:uint8|string):boolean{return true;}} let a:A=new B(); let v:uint8|string=\"s\"; if(a.check(v)){let n:uint8=v; globalThis.__observation=String(n);}"
  ],
  [
    "guard stronger false witness",
    "class A{check(v:uint8|string|boolean):v is uint8|string{return !(v is boolean);}} class B extends A{check(v:uint8|string|boolean):v is uint8{return v is uint8;}} let a:A=new B(); let v:uint8|string|boolean=\"s\"; if(!a.check(v)){let n:boolean=v; globalThis.__observation=String(n);}"
  ]
])('%s', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "function ref ok",
    "function f(ref x: uint8): void {} let g: (ref x: uint8) => void = f; let x:uint8=1; g(ref x);"
  ],
  [
    "function value ok",
    "function f(x: uint8): void {} let g: (x: uint8) => void = f; g(1);"
  ],
  [
    "generic source bound good",
    "function f<T:type extends number>(x:T):T {return x;} let g:(x:number)=>number=f; g(1);"
  ],
  [
    "generic unbounded good",
    "function f<T:type>(x:T):T{return x;} const g:(x:string)=>string=f; g(\"x\");"
  ],
  [
    "generic wider source",
    "function f<T:type extends number>(x:T):T{return x;} function unused(){let g:<T:type extends 1>(x:T)=>T=f;}"
  ],
  [
    "guard override good",
    "class A { check(v:uint8|string):v is uint8{return v is uint8;} } class B extends A {check(v:uint8|string):v is uint8{return v is uint8;}}"
  ],
  [
    "guard no promised narrowing",
    "class A{check(v:uint8|string):boolean{return true;}} class B extends A{check(v:uint8|string):boolean{return true;}}"
  ],
  [
    "call ref direct",
    "function f(ref x:uint8):void{} let n:uint8=1; f(ref n);"
  ],
  [
    "renamed predicate target positions agree",
    "class A{check(v:uint8|string):v is uint8{return v is uint8;}} class B extends A{check(x:uint8|string):x is uint8{return x is uint8;}}"
  ],
  [
    "dependent bound accepts the inferred type",
    "function f<T:type,U:type extends T>(a:T,b:U):U{return b;} let g:(a:number,b:number)=>number=f;g(1,2);"
  ],
  [
    "explicit any keeps a dynamic callable crossing",
    "function f(ref x:uint8):void{} function unused(){let erased:any=f;let g:(x:uint8)=>void=erased;}"
  ]
])('%s', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test('an erased callable still checks reference permissions at runtime', () => {
  expectThrownKind('function f(ref x:uint8):void{} let erased:any=f;let g:(x:uint8)=>void=erased;', 'TypeError');
  expect(ok('function f(ref x:uint8):void{} let erased:any=f;let g:(ref x:uint8)=>void=erased;')).toBe(true);
});


test('an untyped reference parameter still requires an argument', () => {
  expectStaticTypeError('function f(ref x){} function unused(){let g:()=>void=f;}');
});

const guardType = 'function makeGuard(){return Reflect.makeType({kind:"function",signatures:[{parameters:[{name:"v",type:type any}],return:{type:type boolean},narrows:[{target:"v",type:type uint8}]}]});} type G=makeGuard();';

test.each([
  ['contextual arrow renames its predicate target', 'const g:G=(renamed)=>true;g(1);'],
  ['contextual function renames its predicate target', 'const g:G=function(renamed){return true;};g(1);'],
  ['declared predicate survives runtime conformance', 'function predicate(value:any):value is uint8{return true;}const g:G=predicate;g(1);'],
  ['literal predicate survives runtime conformance', 'const g:G=(value:any):value is uint8=>true;g(1);'],
])('%s', (_name, source) => {
  expect(ok(guardType + source)).toBe(true);
});

test.each([
  ['written Boolean return cannot adopt a predicate', 'const g:G=(v:any):boolean=>true;'],
  ['explicit incompatible predicate cannot adopt a predicate', 'const g:G=(v:any):v is string=>true;'],
])('%s', (_name, source) => {
  expectStaticTypeError(guardType + source);
});
