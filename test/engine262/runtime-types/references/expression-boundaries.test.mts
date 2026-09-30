import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test.each([
  [
    "ref return member",
    "function f(a:{x:string}):ref uint8{return ref a.x;}"
  ],
  [
    "ref value argument",
    "function take(x:uint8){}function f(x:string){take(ref x);}"
  ],
  [
    "ref return ordinary control",
    "function f(x:string):uint8{return x;}"
  ],
  [
    "ref return member run",
    "function f(a:{x:string}):ref uint8{return ref a.x;}let a:{x:string}={x:'bad'};f(a);"
  ],
  [
    "ref value argument run",
    "function take(x:uint8){}let x:string='bad';take(ref x);"
  ],
  [
    "reference target mismatch",
    "function take(ref x:uint8){}function f(x:string){take(ref x);}"
  ],
  [
    "reference cannot be returned as a value",
    "function f(x:uint8):uint8{return ref x;}"
  ],
  [
    "reference array argument",
    "function take(x:uint8){}function f(a:[2].<string>){take(ref a[0]);}"
  ],
  [
    "reference constructor argument",
    "class C{constructor(x:uint8){}}function f(x:string){new C(ref x);}"
  ],
  [
    "reference rest argument",
    "function take(...xs:[].<uint8>){}function f(x:string){take(ref x);}"
  ]
])('%s is rejected before evaluation', (_name, source) => {
  expectStaticTypeError(source);
});

test.each([
  [
    "unknown reference return",
    "function f(a:any):ref uint8{return ref a.x;}"
  ]
])('%s remains valid', (_name, source) => {
  expect(ok(source)).toBe(true);
});

test.each([
  [
    "ref return good",
    "function f(a:{x:uint8}):ref uint8{return ref a.x;}let a:{x:uint8}={x:1};String(f(a));",
    "1"
  ],
  [
    "ref value argument good",
    "function take(x:uint8){return x;}let x:uint8=1;String(take(ref x));",
    "1"
  ],
  [
    "ref parameter writes through",
    "function take(ref x:uint8){x=2;}let x:uint8=1;take(ref x);String(x);",
    "2"
  ],
  [
    "generic value argument decays",
    "function take<T:type>(x:T):T{return x;}let x:uint8=1;String(take(ref x));",
    "1"
  ],
  [
    "ordinary value return of ref call",
    "function loc(a:{x:uint8}):ref uint8{return ref a.x;}function f(a:{x:uint8}):uint8{return loc(a);}String(f({x:1}));",
    "1"
  ]
])('%s preserves its result', (_name, source, value) => {
  expect(evaluated(source)).toBe(value);
});

test("ref overload invalid is rejected before evaluation", () => {
  expectStaticTypeError("function take(x:uint8){}function take(x:boolean){}function f(x:string){take(ref x);}");
});

test("ref overload valid preserves behavior", () => {
  expect(evaluated("function take(x:uint8):uint8{return x;}function take(x:string):string{return x;}let x:uint8=1;String(take(ref x));")).toBe("1");
});

test("ref generic constructor preserves behavior", () => {
  expect(ok("class C<T:type>{constructor(x:T){}}let x:uint8=1;let c:C.<uint8>=new C(ref x);")).toBe(true);
});

test("ref spread value valid preserves behavior", () => {
  expect(ok("function take(x:uint8,...xs:[].<uint8>){}function f(x:uint8,xs:[].<uint8>){take(ref x,...xs);}")).toBe(true);
});

test("ref optional valid preserves behavior", () => {
  expect(evaluated("function take(x:uint8){return x;}const t:((x:uint8)=>uint8)|null=take;let x:uint8=1;String(t?.(ref x));")).toBe("1");
});

test("readonly live reference preserves behavior", () => {
  expect(evaluated("let a:[].<uint8>=[1];let ref r=a[0];a.length=0;try{r;}catch(e){String(e instanceof TypeError);}")).toBe("true");
});
