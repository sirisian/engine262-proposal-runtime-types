import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-type-references, #sec-indexed-access-types
test('recursive interface specializations terminate through members and references', () => {
  for (const source of [
    'interface N<T:type> { value:T; next:N.<T>|null; } function unused(n:N.<uint8>){}',
    'interface A<T:type> { next:B.<T>|null; } interface B<T:type> { next:A.<T>|null; } function unused(a:A.<uint8>){}',
    'interface N<T:type> { value:T; get():ref T; readonly next:N.<T>; } function unused(n:N.<uint8>){}',
  ]) {
    expect(ok(source)).toBe(true);
  }
});

test('recursive specialization preserves nested static value checks', () => {
  const declaration = 'interface N<T:type> { value:T; next:N.<T>|null; }';
  expect(ok(`if (false) { ${declaration} const n:N.<uint8> = {value:1,next:{value:2,next:null}}; }`)).toBe(true);
  expectStaticTypeError(`${declaration} const n:N.<uint8> = {value:1,next:{value:"bad",next:null}};`);
});

test('distinct recursive specializations retain their formation obligations', () => {
  const declaration = 'interface N<T:type> { next:N.<T>|null; value:T["x"]; }';
  expect(ok(`${declaration} function good(n:N.<{x:uint8}>){}`)).toBe(true);
  expectStaticTypeError(`${declaration} function good(n:N.<{x:uint8}>){} function bad(n:N.<{y:string}>){} `);
  expectStaticTypeError(`${declaration} function bad(n:N.<{y:string}>){} function good(n:N.<{x:uint8}>){} `);
});
