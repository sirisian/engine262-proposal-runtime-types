import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Question AM, AM2: a comparison that may dispatch to a vector or to a declared operator has type
 * `any` when an operand is `any`.
 *
 * A comparison of two vectors is a mask, and a class's `operator<` returns what it declares. The
 * checker typed `a < b` and `a == b` as `boolean` for `any` operands, so `const t: boolean = a < b`
 * held a vector without the store's check, while `const m: boolean32x4 = a == b` was refused before
 * running. `===`, `!==`, `instanceof` and `in` cannot be overloaded and stay `boolean`.
 */

const AB = 'const a: any = float32x4(1, 2, 3, 4); const b: any = float32x4(1, 2, 0, 4);';

test('a typed store of a comparison through any checks what the comparison produced', () => {
  const result = observeScript(`${AB} const t: boolean = a < b;`);
  expect(result.bodyEntered).toBe(true);
  expect(result.errorClass).toBe('TypeError');
  // Numbers through `any` compare to a boolean, which the store takes.
  expect(evaluated('const a: any = 1; const b: any = 2; const t: boolean = a < b; String(t);')).toBe('true');
  expect(evaluated('const a: any = 1; const b: any = 2; let r = "no"; if (a < b) r = "yes"; r;')).toBe('yes');
});

test('a mask through any reaches a mask position', () => {
  expect(evaluated(`${AB} const m: boolean32x4 = a == b; String(m.any()) + String(m.all());`)).toBe('truefalse');
  expect(evaluated(`${AB} String(boolean32x4(a == b).all());`)).toBe('false');
  expect(evaluated(`${AB} String((a == b) := boolean32x4);`)).toBe(evaluated(`${AB} String(boolean32x4(a == b));`));
});

test('a comparison that cannot be overloaded stays boolean', () => {
  expect(observeScript('const a: any = 1; const b: any = 2; const s: string = a === b;'))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
  expect(evaluated('const a: any = 1; const b: any = 1; const t: boolean = a === b; String(t);')).toBe('true');
});
