import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

// #sec-type-errors: the source a dynamically constructed function is built
// from is checked where CreateDynamicFunction enforces its other early errors,
// so a type error is thrown at construction rather than at a later call.

const construct = (constructor: string, ...sources: string[]) => evaluated(
  `try { ${constructor}(${sources.map((source) => JSON.stringify(source)).join(', ')}); 'constructed'; } catch (e) { e.constructor.name; }`);
const AsyncFunction = 'Object.getPrototypeOf(async function () {}).constructor';
const GeneratorFunction = 'Object.getPrototypeOf(function* () {}).constructor';
const AsyncGeneratorFunction = 'Object.getPrototypeOf(async function* () {}).constructor';

test('a type error in a dynamic function body is thrown at construction', () => {
  expect(construct('new Function', 'type T = uint8 & string; return 1;')).toBe('StaticTypeError');
  expect(construct('new Function', 'let a: int32 = 5; return a / 0;')).toBe('StaticTypeError');
  expect(construct('new Function', 'let x: uint8 = "a"; return x;')).toBe('StaticTypeError');
});

test('the parameters and the body are checked as one source', () => {
  expect(construct('Function', 'a: uint8', 'let s: string = a; return s;')).toBe('StaticTypeError');
});

test('every dynamic function constructor checks its source', () => {
  for (const constructor of [GeneratorFunction, AsyncFunction, AsyncGeneratorFunction]) {
    expect(construct(constructor, 'type T = uint8 & string;')).toBe('StaticTypeError');
  }
});

test('a valid typed dynamic function is constructed and runs', () => {
  expect(evaluated('String(new Function("let x: uint8 = 1; return x;")());')).toBe('1');
  expect(evaluated('String(Function("a: uint8", "return a;")(5));')).toBe('5');
  expect(evaluated('class C { x: uint8 = 1; } String(new Function("let c: C = new C(); return c.x;")());')).toBe('1');
});
