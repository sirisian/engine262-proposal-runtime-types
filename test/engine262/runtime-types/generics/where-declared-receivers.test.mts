import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-generic-where: a method's clause reads its receiver, typed as its
 * class's instance, its object literal's type, or the interface or object
 * type that declares the signature, and is judged against it at the
 * declaration. A default its own clause rejects can never be taken, on a
 * signature as on a method.
 */

const refused = (source: string, rule: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });

test('an object-literal method is judged against the literal', () => {
  refused("const o = { x: (1 := uint8), m() where this.x > 300 { return 1; } }; 'ok';", 'rt-numeric-range');
  expect(evaluated('const o = { x: (1 := uint8), m() where this.x > 0 { return 1; } }; String(o.m());')).toBe('1');
  expect(evaluated("const o = { x: (1 := uint8), m() where this.x > 0 { return 1; } }; const p = { x: (0 := uint8), m: o.m }; let r = 'none'; try { p.m(); r = 'ran'; } catch (e) { r = 'threw'; } r;")).toBe('threw');
  expect(evaluated('class K { y: uint8 = 1; m() { const o = { x: (1 := uint8), n() where this.x > 0 { return 1; } }; return o.n(); } } String(new K().m());')).toBe('1');
});

test('a signature is judged against its declaring type', () => {
  refused("interface I { x: uint8; m(): void where this.x > 300; } 'ok';", 'rt-numeric-range');
  refused("type T = { x: uint8, m(): void where this.x > 300 }; 'ok';", 'rt-numeric-range');
  expect(evaluated("interface I { x: uint8; m(): void where this.x > 0; } 'ok';")).toBe('ok');
});

test('a signature default its own clause rejects is refused', () => {
  refused("interface J { m(i: uint32 = 5): void where i > 10; } 'ok';", 'rt-unreachable-default');
  expect(evaluated("interface J { m(i: uint32 = 15): void where i > 10; } 'ok';")).toBe('ok');
});
