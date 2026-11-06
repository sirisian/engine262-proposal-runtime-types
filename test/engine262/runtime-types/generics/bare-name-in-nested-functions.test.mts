import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// A generic class's bare name in its own body is the class over its own
// parameters, including in a function nested in a member, where it is the
// same type as the application written `W.<T>`.

test('a nested function expression returns the bare name as its specialization', () => {
  expect(evaluated(`class W<T: type = string> { v: T; constructor(v: T) { this.v = v; }
    get(): string { const self = this; const f = function (): W { return self; }; return String(Reflect.typeOf(f())); } }
    new W.<uint8>((1 := uint8)).get();`)).toBe('W.<uint.<8>>');
});

test('a class without defaults, and the default specialization, agree', () => {
  expect(evaluated(`class W<T: type> { v: T; constructor(v: T) { this.v = v; }
    get(): string { const f = (): W => this; return String(Reflect.typeOf(f())); } }
    new W.<uint8>((1 := uint8)).get();`)).toBe('W.<uint.<8>>');
  expect(evaluated(`class W<T: type = string> { v: T; constructor(v: T) { this.v = v; }
    get(): string { const f = (): W => this; return String(Reflect.typeOf(f())); } }
    new W('s').get();`)).toBe('W.<string>');
});
