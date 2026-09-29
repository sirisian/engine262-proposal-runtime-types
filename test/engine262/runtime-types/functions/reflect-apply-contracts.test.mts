import { expect, test } from 'vitest';
import { expectStaticTypeError, ok, evaluatedSequence } from '../harness.mts';

test.each([
  "function f(x:uint8){}Reflect.apply(f,undefined,[\"x\"]);",
  "function f(x:uint8){}Reflect.apply(f,undefined,{0:\"s\",length:1});",
  "function f(x:uint8){}Reflect.apply(f,undefined,[]);",
  "function f(...xs:[].<uint8>){}Reflect.apply(f,undefined,[\"s\"]);",
  "function f(ref x:uint8){}Reflect.apply(f,undefined,[1]);"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "function f(x:uint8){}Reflect.apply(f,undefined,[1]);",
  "function f(x:uint8){}Reflect.apply(f,undefined,{0:1,length:1});",
  "function unused(f:any,args:any){Reflect.apply(f,undefined,args);}",
  "function f(x:uint8=1){}Reflect.apply(f,undefined,[]);",
  "function f(x:uint8){}function f(x:string){}Reflect.apply(f,undefined,[\"s\"]);",
  "function unused(){function f(x:uint8){}Reflect.apply(f,undefined,[\"s\"]);}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});

test("reflect apply replaced", () => {
  expect(evaluatedSequence([
  "Reflect.apply=function(){return 0;};",
  "function f(x:uint8){}Reflect.apply(f,undefined,[\"s\"]);\"accepted\";"
])).toBe('accepted');
});
