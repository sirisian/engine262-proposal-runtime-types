import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

test.each(['f', '#f', 'static f', 'static #f'])('field %s requires a possible default or an initializer', (field) => {
  expectStaticTypeError(`function unused() { class C { ${field}: (n: uint8) => uint8; } }`);
  expect(ok(`class C { ${field}: (n: uint8) => uint8 = (n: uint8): uint8 => n; } new C();`)).toBe(true);
});

test('generic field defaults are decided at specialization', () => {
  expect(ok('class C<T: type> { f: T; }')).toBe(true);
  expect(ok('class C { n: uint8; } new C();')).toBe(true);
});
