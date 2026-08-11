import { test, expect } from 'vitest';
import { run } from '../harness.mts';

/**
 * How a type renders in a diagnostic.
 *
 * `displayType` is a switch ending `default: return t.Kind`, and four kinds had
 * no case - `object`, `function`, `reference`, `parameter` - so they printed
 * their KIND NAME. `let a: { x: int32 } = { y: 1 }` reported "is not assignable
 * to \"object\"", naming neither the type nor what was wrong with the value.
 *
 * Every other case renders SOURCE SYNTAX, so the convention was already set;
 * these four now follow it.
 *
 * The strings are DIAGNOSTICS, not an API - `Reflect.getReflection` is the
 * inspection surface. They are asserted here by containment rather than
 * equality so that surrounding wording can change without these failing.
 */

const message = (src: string): string => {
  const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
  return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
};

test('an object type renders its structure', () => {
  expect(message('type A = { x: int32 }; let a: A = { y: 1 };')).toContain('{ x: int.<32> }');
  expect(message('type A = { x: int32, y: float64 }; let a: A = 5;')).toContain('{ x: int.<32>, y: float64 }');
  // An optional property keeps its mark.
  expect(message('type A = { x?: int32 }; let a: A = 5;')).toContain('x?: int.<32>');
  // An index signature is held apart from the properties; a type with one and
  // no properties must not render as an empty object.
  expect(message('type O = { [k: string]: uint8 }; let o: O = 5;')).toContain('{ [string]: uint.<8> }');
  // A genuinely empty object type.
  expect(message('type O = { }; let o: O = 5;')).toContain('{}');
});

test('a function type renders its signature', () => {
  expect(message('let f: (x: uint8) => uint8 = 5;')).toContain('(x: uint.<8>) => uint.<8>');
  // A `void` return, which must not print as `null`.
  expect(message('let f: (x: uint8) => void = 5;')).toContain('=> void');
  // Overloads join with `&`, as an overloaded function type is written.
  expect(message('type F = ((x: uint8) => uint8) & ((x: float64) => float64); let f: F = 5;')).toContain('(x: uint.<8>) => uint.<8> & (x: float64) => float64');
});

test('the display nests through other kinds', () => {
  // Each of these had the inner type swallowed even when the outer one rendered.
  expect(message('type A = { p: { x: int32 } }; let a: A = 5;')).toContain('{ p: { x: int.<32> } }');
  expect(message('let a: [].<{ x: int32 }> = 5;')).toContain('[].<{ x: int.<32> }>');
  expect(message('type A = { x: int32 }; type B = { y: float64 }; type C = A & B; let c: C = 5;')).toContain('{ x: int.<32> } & { y: float64 }');
  expect(message('type A = { x: int32 }; type B = { y: float64 }; type C = A | B; let c: C = 5;')).toContain('{ x: int.<32> } | { y: float64 }');
});

test('the kinds that already rendered are unchanged', () => {
  // Asserted through the same mechanism so this change cannot quietly alter
  // them. `displayType` feeds every diagnostic in the engine.
  expect(message('let x: uint8 = "s";')).toContain('uint.<8>');
  expect(message('let x: [uint8, uint8] = 5;')).toContain('[uint.<8>, uint.<8>]');
  expect(message('let x: [3].<uint8> = 5;')).toContain('[3].<uint.<8>>');
  expect(message('let x: never = 5;')).toContain('never');
  expect(message('class K { } class L { } type C = K & L; let c: C = new K();')).toContain('K & L');
});

test('the display is not an identity', () => {
  // Two distinct types may render alike; rendering is for reading, and the
  // records remain distinct. `getReflection` is the inspection surface.
  expect(message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B; let c: C = { x: 1 };')).toContain('is not assignable to');
  const c = run('type A = { x: int32 }; type B = { x: float64 }; type C = A & B; const r = Reflect.getReflection(C); String(r.kind);') as { Value?: { stringValue?: () => string } };
  expect(c.Value?.stringValue?.()).toBe('intersection');
});
