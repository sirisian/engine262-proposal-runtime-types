import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * The layout controls, and the divergence that hid them.
 *
 * These run with the `decorators` feature ON, which the rest of the suite does
 * not, because the seven reserved controls are decorators and a program cannot
 * write one without it. Turning it on is what exposed the divergence these
 * tests exist to prevent recurring: ClassDefinitionEvaluation has two branches,
 * one taken with decorators and one without, and every runtime-types class
 * behaviour had been added to the branch without them. With decorators enabled
 * a typed class had no field types, no seal, no frozen prototype, and no
 * layout.
 */
function evaluated(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types', 'decorators'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function thrown(source: string): boolean {
  setSurroundingAgent(new Agent({ features: ['runtime-types', 'decorators'] }));
  const realm = new ManagedRealm();
  return (realm.evaluateScriptSkipDebugger(source) as unknown as { Type: string }).Type === 'throw';
}

test('a typed class keeps its types under the decorators feature', () => {
  // THE BLOCKER. `class A { a: uint8; }` with decorators on produced a field
  // carrying no type: `x.a = 300` stored 300, the store boundary of
  // #table-check-sites silently absent. One declaration, two evaluation paths,
  // and only one of them knew the field had a type.
  expect(thrown('class A { a: uint8; } const x = new A(); x.a = 300;')).toBe(true);
  expect(evaluated('class A { a: uint8; } const x = new A(); String(x.a is uint8);')).toBe('true');
  // A typed field with no initializer takes its type's default, and an
  // initializer is converted rather than kept as written (F57).
  expect(evaluated('class A { a: uint8; } String(Number(new A().a));')).toBe('0');
  expect(evaluated('class I { b: uint8 = 1; } String((new I()).b is uint8);')).toBe('true');
  // Stage A's seal and Stage B's layout were missing from this branch for the
  // same reason.
  expect(evaluated('class A { a: uint8; } String(Object.isFrozen(A.prototype));')).toBe('true');
  expect(evaluated('class N { a: uint8; b: uint16; } String((type N).byteLength) + "/" + String((type N).alignment);')).toBe('4/2');
});

test('the reserved layout controls place a class and its fields', () => {
  // #sec-layout-control: seven reserved names. RESERVED, so they are recognized
  // syntactically and never evaluated - `@packed` names no binding, and making
  // the seven global would put `offset`, `size`, and `align` in every program's
  // scope.
  //
  // `packed` removes the padding and gives the class alignment 1. The design's
  // own example.
  expect(evaluated('@packed class P { a: uint8; b: uint16; } String((type P).byteLength) + "/" + String((type P).alignment);')).toBe('3/1');
  expect(evaluated('@packed class P { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassField, P>("b").offset);')).toBe('1');

  // `alignAll` decides the INSTANCE's alignment and `size` its allocated size,
  // while `packed` decides the FIELDS' placement - the clause is explicit that
  // they compose rather than conflict. `offset` places a field outright, and
  // `align` REPLACES a field's alignment rather than strengthening it: the
  // design works this exact case, and a `float32x4` at `@align(4)` following a
  // `float32` at byte 2 lands at byte 8 rather than at 16. Taking the max
  // instead is the obvious wrong implementation, so all four are asserted in
  // one declaration.
  const four = '@alignAll(16) @size(32) class A { @offset(2) x: float32; @align(4) y: float32x4; } ';
  expect(evaluated(`${four} String((type A).byteLength) + "/" + String((type A).alignment);`)).toBe('32/16');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassField, A>("x").offset);`)).toBe('2');
  expect(evaluated(`${four} String(Reflect.getReflection.<Reflect.ClassField, A>("y").offset);`)).toBe('8');

  // An ordinary decorator is untouched by the reserved-name handling.
  expect(evaluated('function d(v) { return v; } @d class D { a: uint8; } String((type D).byteLength);')).toBe('1');
});
