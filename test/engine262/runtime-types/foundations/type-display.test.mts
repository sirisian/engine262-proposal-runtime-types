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

test('a symbol-keyed property renders its description', () => {
  // Interpolating a SymbolValue gives "[object Symbol]", which is the same class
  // of bug one layer down from the one being fixed.
  expect(message('const s = Symbol("tag"); type O = { [s]: uint8 }; let o: O = 5;')).toContain('{ [tag]: uint.<8> }');
});

test('a reference type renders its target', () => {
  expect(message('let r: ref uint8 = 5;')).toContain('ref uint.<8>');
});

test('a generic parameter renders its name and constraint', () => {
  // An unconstrained parameter is used where its own type is the target, so it
  // reaches the display through a constrained specialization being refused.
  expect(message('function f<T: uint8>(x: T): T { return x; } f.<string>("s");')).toContain('uint.<8>');
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

test('the two kinds the exhaustiveness check found', () => {
  // `pattern` and `range` also had no case, and were found by making the
  // default a `never` assignment rather than by reading the switch - the plan's
  // own survey counted four falling-through kinds and there were six.
  expect(message('let p: /ab+c/ = 5;')).toContain('/ab+c/');
  expect(message('let r: 0..<10 = "s";')).toContain('0..10');
  expect(message('let r: 0..=10 = "s";')).toContain('0..=10');
});

test('a shared type renders its target', () => {
  // `shared` had a case already, but reaching it takes care: a DIRECT binding of
  // a wrong value goes down the conversion-source path -
  // "a string is not a conversion source for ..." - which never consults the
  // display. It renders when the shared type is nested inside another, which is
  // where a reader most needs it.
  expect(message('let a: [].<shared uint32> = "s";')).toContain('[].<shared uint.<32>>');
  expect(message('type O = { s: shared uint32 }; let o: O = 5;')).toContain('{ s: shared uint.<32> }');
  expect(message('type U = shared uint32 | null; let u: U = "s";')).toContain('shared uint.<32>');
  // The intersection member is an OBJECT type rather than a bare `shared uint32`:
  // #sec-intersection-type-early-errors now rejects the written `A & shared uint32`,
  // no value being both an object and a `uint32`, so the display it was reached
  // through is unreachable from that spelling. An inhabited intersection carrying a
  // `shared` member exercises the same case.
  expect(message('type A = { a: uint8 }; type C = A & { s: shared uint32 }; let c: C = 5;')).toContain('{ s: shared uint.<32> }');
});

test('the kinds that already rendered are unchanged', () => {
  // Asserted through the same mechanism so this change cannot quietly alter
  // them. `displayType` feeds every diagnostic in the engine.
  expect(message('let x: uint8 = "s";')).toContain('uint.<8>');
  expect(message('let x: [uint8, uint8] = 5;')).toContain('[uint.<8>, uint.<8>]');
  expect(message('let x: [3].<uint8> = 5;')).toContain('[3].<uint.<8>>');
  expect(message('let x: never = 5;')).toContain('never');
  expect(message('class K { } class L { } type C = K & L; let c: C = new K();')).toContain('K & L');
  // `literal` and `any`. The literal form appears on the SOURCE side of almost
  // every message, and `any` renders where it is nested inside another type.
  expect(message('type L = 5; let x: L = 6;')).toContain('a literal type of number');
  expect(message('type O = { a: any }; let o: O = 5;')).toContain('{ a: any }');
  expect(message('let a: [].<any> = 5;')).toContain('[].<any>');
});

test('the display is not an identity', () => {
  // Two distinct types may render alike; rendering is for reading, and the
  // records remain distinct. `getReflection` is the inspection surface.
  expect(message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B; let c: C = { x: 1 };')).toContain('is not assignable to');
  const c = run('type A = { x: int32 }; type B = { x: float64 }; type C = A & B; const r = Reflect.getReflection(C); String(r.kind);') as { Value?: { stringValue?: () => string } };
  expect(c.Value?.stringValue?.()).toBe('intersection');
});

test('an intersection refusal names the intersection AND the member', () => {
  // The member's own error names the member and not the intersection it came
  // from, so `A & B` reported only that the value did not fit `B` and left the
  // reader to work out where `B` came from. The loop knows which member
  // rejected, so it says both.
  const conflict = message('type A = { x: int32 }; type B = { x: float64 }; type C = A & B; let c: C = { x: 1 };');
  expect(conflict).toContain('{ x: float64 } & { x: int.<32> }');
  expect(conflict).toContain('does not satisfy');

  // The member NAMED is the one that rejected, in either direction - not a
  // fixed one that happens to look right in the common case.
  expect(message('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { x: 1 };')).toContain('does not satisfy "{ y: int.<32> }"');
  expect(message('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { y: 1 };')).toContain('does not satisfy "{ x: int.<32> }"');
});

test('an inhabitable intersection is unaffected', () => {
  // The improvement is about DISPLAY, not about detecting conflicts: a value
  // satisfying every member still passes, and a wrong value against an
  // inhabitable intersection gets the same improved message.
  const c = run('type A = { x: int32 }; type B = { y: int32 }; type C = A & B; let c: C = { x: 1, y: 2 }; String(Number(c.x));') as { Value?: { stringValue?: () => string } };
  expect(c.Value?.stringValue?.()).toBe('1');
});
