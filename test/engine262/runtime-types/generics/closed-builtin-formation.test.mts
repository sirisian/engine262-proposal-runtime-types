import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each([
  "type C<T:type>=Composite.<T>;type Bad=C.<uint8>;",
  "type C<T:type>=Composite.<T>;function unused(x:C.<uint8>){}",
  "type V<T:type>=vector.<T,4>;type Bad=V.<string>;",
  "type V<T:type>=vector.<T,4>;function f(v:V.<string>){}",
  "type Bad=Composite.<uint8>;",
  "type V<T:type>=vector.<T,4>;type Bad={read:()=>V.<string>};",
  "type C<T:type>=Composite.<T>;interface I<T:type>{value:C.<T>}type Bad=I.<uint8>;"
])('rejects an established invalid contract before evaluation: %s', (source) => {
  expectStaticTypeError(source);
});

test.each([
  "type V<T:type>=vector.<T,4>;",
  "type V<T:type>=vector.<T,4>;type Good=V.<uint8>;",
  "type C<T:type>=Composite.<T>;type Good=C.<{x:uint8}>;",
  "type C<T:type>=Composite.<T>;type Box<T:type>={value:C.<T>};type Good=Box.<{x:uint8}>;",
  "type V<T:type>=vector.<T,4>;function f<T:type>(v:V.<T>){}"
])('preserves a valid or unresolved contract: %s', (source) => {
  expect(ok(source)).toBe(true);
});
