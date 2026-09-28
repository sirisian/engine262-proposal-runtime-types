import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Phase 5, slice 2: alias specializations (plan 6.4). An alias CASE - an alias
// declaration whose list specializes its family - supplies the right-hand side
// an application selects once its arguments are known, by the rule function
// and class cases use.

const A = 'type Storage<T: type> = T; type Storage<boolean> = uint8; ';

test('an application selects the case\'s right-hand side, or the primary\'s, at run time', () => {
  expect(evaluated(`${A} String(Storage.<boolean>) + "," + String(Storage.<uint16>);`)).toBe('uint.<8>,uint.<16>');
});

test('the checker selects the same right-hand side', () => {
  expect(evaluated(`${A} let x: Storage.<boolean> = (1 := uint8); let y: Storage.<uint16> = (2 := uint16); String(x) + "," + String(y);`)).toBe('1,2');
  expectThrown(`${A} let x: Storage.<boolean> = true;`, '"true" is not assignable to "uint.<8>"');
});

test('an application over an open parameter is deferred, and selected once its arguments close', () => {
  // Plan 6.4: which case applies is not decided while an argument is open. The
  // application is DEFERRED - a record relating only to itself - and
  // substitution selects its right-hand side once the arguments close.
  const F = `${A} function f<T: type>(v: Storage.<T>): Storage.<T> { return v; } `;
  expect(evaluated(`${F} "ok";`)).toBe('ok');
  expect(evaluated(`${F} String(f.<boolean>((1 := uint8))) + "," + String(f.<uint16>((2 := uint16)));`)).toBe('1,2');
  expectThrown(`${F} f.<boolean>(true);`, '"true" is not assignable to "uint.<8>"');
  // The primary's right-hand side is never assumed: a T is not a Storage.<T>.
  expectThrown(`${A} function g<T: type>(v: T): Storage.<T> { return v; }`, '"T" is not assignable to "Storage.<T>"');
});

test('an alias case belongs to an alias primary in its own statement list', () => {
  expectThrown('type Storage<boolean> = uint8;', 'no `type Storage<...>` in this statement list declares the family it would specialize');
  // A case's primary is of its own kind: a class does not own an alias case.
  expectThrown('class Storage<T: type> {} type Storage<boolean> = uint8;', 'no `type Storage<...>` in this statement list');
  // A case declares no name of its own, so it is no redeclaration.
  expect(evaluated(`${A} "ok";`)).toBe('ok');
});

test('a library nominal pattern exposes its declared arguments', () => {
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<Map.<string, const E>>(): string { return "map"; } f.<Map.<string, uint8>>();')).toBe('map');
});
