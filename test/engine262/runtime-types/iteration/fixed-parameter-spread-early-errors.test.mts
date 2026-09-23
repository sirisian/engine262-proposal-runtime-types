import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test("R48: one element unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}");
});

test("R48: one element executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}f({[Symbol.iterator]:words});");
});

test("R48: no elements unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{}");
});

test("R48: no elements executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});");
});

test("R48: several elements unused", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";yield \"worse\";}");
});

test("R48: several elements executed", () => {
  expectStaticTypeError("function take(n:uint8):void{globalThis.hookRan=true;}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function* words():Generator.<string,void,void>{yield \"bad\";yield \"worse\";}f({[Symbol.iterator]:words});");
});

test("R48: constructor unused", () => {
  expectStaticTypeError("class C{constructor(n:uint8){globalThis.hookRan=true;}}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){new C(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}");
});

test("R48: constructor executed", () => {
  expectStaticTypeError("class C{constructor(n:uint8){globalThis.hookRan=true;}}function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){new C(...s);}function* words():Generator.<string,void,void>{yield \"bad\";}f({[Symbol.iterator]:words});");
});

test("R48: optional permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n?:uint8):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: default permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8=1):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: undefined permits empty", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8|undefined):void{}function* words():Generator.<string,void,void>{}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: union accepts string", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n:uint8|string):void{}function* words():Generator.<string,void,void>{yield \"ok\";}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: untyped parameter", () => {
  expect(ok("function f(s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...s);}function take(n):void{}function* words():Generator.<string,void,void>{yield \"ok\";}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: named argument spread", () => {
  expect(ok("function take(n:uint8):void{}function f(){take(...{n:1});}f();")).toBe(true);
});

test("R48: unknown source", () => {
  expect(ok("function take(n:uint8):void{}function f(s:any){take(...s);}f([1]);")).toBe(true);
});

test("R48: numeric contribution valid", () => {
  expect(ok("function take(n:uint8):void{}function f(s:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){take(...s);}function* words():Generator.<uint8,void,void>{yield 1;}f({[Symbol.iterator]:words});")).toBe(true);
});

test("R48: any callee", () => {
  expectThrownKind("function f(g:any,s:{[Symbol.iterator]:()=>Generator.<string,void,void>}){g(...s);}function take(n:uint8):void{}function* words():Generator.<string,void,void>{yield \"bad\";}f(take,{[Symbol.iterator]:words});", 'TypeError');
});

test("R48: prefix already checked", () => {
  expectStaticTypeError("function take(n:uint8):void{}function f(s:any){take(\"bad\",...s);}");
});

test("R48: known prefix", () => {
  expectStaticTypeError("function take(s:string,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(\"x\",...xs);}");
});

test("R48: later impossible slot", () => {
  expectStaticTypeError("function take(s:string,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}");
});

test("R48: known suffix can fill required slot", () => {
  expect(ok("function take(s:string|undefined,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs,1);}")).toBe(true);
});

test("R48: rest layout deferred", () => {
  expect(ok("function take(...s:[].<string>,n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}")).toBe(true);
});

test("R48: multiple spreads deferred", () => {
  expect(ok("function take(n:uint8):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>},ys:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}){take(...xs,...ys);}")).toBe(true);
});

test("R48: upstream number to string conversion", () => {
  expect(ok("function take(s:string):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<number,void,void>}){take(...xs);}")).toBe(true);
});

test("R48: unknown generic contribution", () => {
  expect(ok("function take(n:uint8):void{}function f<T: type>(xs:{[Symbol.iterator]:()=>Generator.<T,void,void>}){take(...xs);}")).toBe(true);
});

test("R48: mutable array iterator unknown", () => {
  expect(ok("function take(n:uint8):void{}function f(xs:[].<string>){take(...xs);}")).toBe(true);
});

test("R48: super fixed parameter", () => {
  expectStaticTypeError("class B{constructor(n:uint8){}}class D extends B{constructor(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){super(...xs);}}");
});

test("R48: all invalid overloads", () => {
  expectStaticTypeError("function take(n:uint8):void{}function take(n:boolean):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}");
});

test("R48: viable overload", () => {
  expect(ok("function take(n:uint8):void{}function take(n:string):void{}function f(xs:{[Symbol.iterator]:()=>Generator.<string,void,void>}){take(...xs);}")).toBe(true);
});

test("R48: iteration is performed once and effects survive", () => {
  expect(evaluated("let visits=0;function take(n:uint8):void{}const xs:{[Symbol.iterator]:()=>Generator.<uint8,void,void>}={[Symbol.iterator]:function*():Generator.<uint8,void,void>{visits++;yield uint8(1);}};take(...xs);String(visits);")).toBe("1");
});

test("R48: replacement array iterator supplies actual arguments", () => {
  expect(evaluated("function take(n:uint8):uint8{return n;}let xs:[].<string>=[\"bad\"];xs[Symbol.iterator]=function*(){yield uint8(9);};String(take(...xs));")).toBe("9");
});

test('a Symbol-keyed array property has no indexed element contract', () => {
  expect(evaluated('const key=Symbol();let a:[].<uint8>=[1];a[key]="ok";a[key];')).toBe('ok');
  expect(ok('function f(a:[].<uint8>,key:symbol){a[key]="ok";}')).toBe(true);
});

test('numeric indexed writes still enforce the element contract', () => {
  expectStaticTypeError('function f(a:[].<uint8>){a[0]="bad";}');
});
