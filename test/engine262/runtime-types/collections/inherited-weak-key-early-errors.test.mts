import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

const classes = 'class Base { x: uint8; } class Derived extends Base {} ';
for (const type of ['WeakMap.<Derived, uint8>', 'WeakSet.<Derived>', 'WeakRef.<Derived>']) {
  test(`inherited typed storage is rejected at ${type} type formation`, () => {
    expectStaticTypeError(`${classes} type Bad = ${type};`);
    expectStaticTypeError(`${classes} function unused(value: ${type}) {}`);
  });
}

test('an empty weak collection still checks its inherited key type', () => {
  expectStaticTypeError(`${classes} new WeakMap.<Derived, uint8>();`);
  expectStaticTypeError(`${classes} new WeakSet.<Derived>();`);
});

test('weak argument sites reject inherited typed storage in unused bodies', () => {
  for (const operation of [
    'new WeakRef(value)',
    'new WeakMap.<object, uint8>().set(value, 1)',
    'new WeakSet.<object>().add(value)',
    'new FinalizationRegistry.<uint8>((held) => {}).register(value, 1)',
    'new FinalizationRegistry.<uint8>((held) => {}).register({}, 1, value)',
  ]) expectStaticTypeError(`${classes} function unused(value: Derived) { ${operation}; }`);
});

test('weak classification follows generic and multi-level bases', () => {
  expectStaticTypeError('class Base<T> { x: T; } class Middle<T> extends Base.<T> {} class Derived extends Middle.<uint8> {} function unused(value: Derived) { new WeakRef(value); }');
  expectStaticTypeError('class Base { x: uint8; } dynamic class Derived extends Base {} function unused(value: Derived) { new WeakRef(value); }');
});

test('reference class identity is inherited and remains weakly observable', () => {
  expect(evaluated('reference class Base { x: uint8; } class Derived extends Base {} const value = new Derived(); const ref = new WeakRef(value); String(ref.deref() === value);')).toBe('true');
  expect(ok('class Base { x: uint8; } reference class Derived extends Base {} new WeakRef(new Derived());')).toBe(true);
});

test('dynamic roots, ordinary classes and typed arrays retain weak identity', () => {
  expect(ok('dynamic class Base { x: uint8; } class Derived extends Base {} new WeakRef(new Derived());')).toBe(true);
  expect(ok('class Base { x = 1; } class Derived extends Base {} new WeakRef(new Derived());')).toBe(true);
  expect(ok('let value: [2].<uint8> = [1, 2]; new WeakRef(value);')).toBe(true);
});

test('unknown values and ancestry defer to runtime weak eligibility', () => {
  expect(ok(`${classes} function unused(value: any) { new WeakRef(value); }`)).toBe(true);
  expectThrownKind(`${classes} function run(value: any) { new WeakRef(value); } run(new Derived());`, 'TypeError');
  expect(ok('function make(Base: any) { class Derived extends Base { x: uint8; } function unused(value: Derived) { new WeakRef(value); } }')).toBe(true);
});
