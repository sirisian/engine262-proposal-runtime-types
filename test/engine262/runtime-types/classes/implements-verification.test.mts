// PLAN-variadic-and-named-generic-arguments.md F-AB: `implements` is verified.
// Every member an interface requires must be declared by the class with an
// assignable type; a generic method satisfies the interface's through identity
// up to renaming (Phase 5's relation), so `on<U>` satisfies `on<T>` and
// `on<T, U>` does not; an optional member may be absent. Before this the
// checker merged the interface's members into the class and verified nothing.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const BUS = 'interface Bus { on(name: string): void; }';

test('a class satisfying its interface declares and evaluates', () => {
  expect(evaluated(`${BUS} class Ok implements Bus { on(name: string): void {} } "declared";`)).toBe('declared');
  expect(evaluated('interface P { x: uint8; y?: string; } class C implements P { x: uint8 = 1; } "declared";')).toBe('declared');
});

test('a missing required member is refused, naming the class, the member, and the interface', () => {
  expectThrown(`${BUS} class Bad implements Bus {}`, 'declares no member on');
});

test('a member of the wrong type is refused', () => {
  expectThrown(`${BUS} class Bad implements Bus { on(x: uint8): void {} }`, 'not assignable');
  expectThrown('interface P { x: uint8; } class C implements P { x: string = "s"; }', 'not assignable');
});

test('a generic method satisfies through identity up to renaming, and a different shape does not (F-AB)', () => {
  const G = 'interface GBus { on<T>(name: string, h: (e: T) => void): void; }';
  expect(evaluated(`${G} class Ok implements GBus { on<U>(name: string, h: (e: U) => void): void {} } "declared";`)).toBe('declared');
  expectThrown(`${G} class Bad implements GBus { on<T, U>(name: string, h: (e: T) => void): void {} }`, 'not assignable');
});
