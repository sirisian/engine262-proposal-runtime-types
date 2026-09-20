import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A PRIMITIVE OPERATOR BLOCK'S OWN TYPE PARAMETERS ARE IN SCOPE.
 *
 * #sec-primitive-operator-blocks: "A declaration of the form `primitive` _T_ _P_
 * `{` ... `}`, where _T_ names a primitive type and _P_ is an optional
 * |TypeParameters| constrained by a meta type", with the grammar
 * `primitive` TypeName TypeParameters? `{` OperatorDefinitionList? `}`.
 *
 * The parser accepted _P_ and the runtime collected its names, but nothing bound
 * them, so the form the clause defines answered `"T" is not defined` and could
 * not be used at all - for any primitive.
 *
 * It matters most for a primitive that ALREADY takes type parameters. Without
 * _P_, a cast has to be written `operator complex.<P>()`, and there `complex.<P>`
 * is read as a COMPONENT argument, because `complex` takes one. With _P_ on the
 * block, `complex.<T>` names the block's parameter and the reading is
 * unambiguous.
 */

const CX = `type P = { phase: int32 };
meta P { default = { phase: 0 }; subtype(a: P, b: P): boolean { return true; } }
primitive complex<T: P> { operator complex.<T>() { return this; } }
type Ph = complex.<float64>.<{ phase: 1 }>;
`;
const RAT = `type U = { unit: int32 };
meta U { default = { unit: 0 }; subtype(a: U, b: U): boolean { return true; } }
primitive rational<T: U> { operator rational.<T>() { return this; } }
type Ratio = rational.<64>.<{ unit: 1 }>;
`;

test('the parameterized block declares without error', () => {
  expect(evaluated(`${CX}'DECLARED';`)).toBe('DECLARED');
  expect(evaluated(`${RAT}'DECLARED';`)).toBe('DECLARED');
});

test('and its cast crosses a value into a parameterization', () => {
  expect(evaluated(`${CX}const c: complex128 = 1 + 2i; String(c := Ph);`)).toBe('1+2i');
  expect(evaluated(`${RAT}const r: rational = 1 / 3; String(r := Ratio);`)).toBe('1/3');
});

test('a block parameter is still unknown outside its block', () => {
  // The frame is pushed for the operator definitions and popped after, so `T`
  // does not leak into the surrounding source text.
  expectThrown(`${CX}type Leak = complex.<T>;`, 'is not defined');
});

test('the parameterless form is unchanged', () => {
  expect(evaluated(`type D = { m: int32 };
    meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return true; } }
    primitive float32 { operator float32.<D>() { return this; } }
    type Meter = float32.<{ m: 1 }>;
    String(5 := Meter);`)).toBe('5');
  expect(evaluated(`type C = { scale: int32 };
    meta C { default = { scale: 0 }; subtype(a: C, b: C): boolean { return true; } }
    primitive decimal128 { operator decimal128.<C>() { return this; } }
    type Cents = decimal128.<{ scale: 2 }>;
    const d: decimal128 = 19.9; const p: Cents = d; String(p);`)).toBe('19.9');
});
