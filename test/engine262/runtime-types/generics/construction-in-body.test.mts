import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Inside a generic class's own body, `new B(args)` constructs the specialization being evaluated
// - what the inner class binding names at run time - so the
// checker types it over the class's OWN parameters and checks its arguments at
// them, rather than inferring another specialization from the arguments,
// falling back to `any`, or taking a value parameter's default, none of which
// is what runs.

const B = 'class B<T: type = uint8> { v: T; constructor(v: T) { this.v = v; } ';

test('construction in the body is typed over the class\'s own parameters', () => {
  expectThrown(`${B} mk(): void { const z: string = new B(this.v); } }`, '"B.<T>" is not assignable to "string"');
  // A value parameter's construction is `P.<S>`, not its default `P.<200>`.
  expectThrown('class P<S: uint32 = 200> { mk(): void { const z: string = new P(); } }', '"P.<S>" is not assignable to "string"');
});

test('an argument that does not meet the own parameter is a static error', () => {
  // The body is checked for every T: a `uint16` is a `T` only when T is uint16.
  expectThrown(`${B} mk(): void { new B((1 := uint16)); } }`, '"uint.<16>" is not assignable to "T"');
  // At run time the same program constructs the running specialization and the
  // stricter boundary rule refuses the uint16; the checker now says so first.
});

test('at run time the running specialization is constructed', () => {
  expect(evaluated(`${B} mk(): string { return String(Reflect.typeOf(new B(this.v))); } } new B.<uint16>((3 := uint16)).mk();`)).toBe('B.<uint.<16>>');
  expect(evaluated('class P<S: uint32 = 200> { mk(): string { return String(Reflect.typeOf(new P())); } } new P.<7>().mk();')).toBe('P.<7>');
});

test('outside the body, and with explicit arguments, construction is unchanged', () => {
  // Outside: the arguments still infer the specialization.
  expect(evaluated(`${B} } String(Reflect.typeOf(new B((1 := uint16))));`)).toBe('B.<uint.<16>>');
  expectThrown(`${B} } const z: string = new B((1 := uint16));`, '"B.<uint.<16>>" is not assignable to "string"');
  // Inside, `new B.<X>(...)` names its specialization explicitly.
  expectThrown(`${B} mk(): void { const z: string = new B.<uint16>((1 := uint16)); } }`, '"B.<uint.<16>>" is not assignable to "string"');
});
