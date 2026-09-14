import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

test('binding-carrying tests require a governed position', () => {
  expectStaticTypeError('function f() { 1 is let x; }');
  expectStaticTypeError('function f() { const result = 1 is let x; }');
  expectStaticTypeError('function f() { if (uint8(1) is let x: uint8) {} return x; }');
});

test.each(['x = 2', 'x++', '[x] = [2]'])('is bindings are immutable under %s', (write) => {
  expectStaticTypeError(`function f() { if (uint8(1) is let x: uint8) { ${write}; } }`);
  expectStaticTypeError(`function f() { if (uint8(1) is const x: uint8) { ${write}; } }`);
});

test('pattern shadowing preserves the outer binding', () => {
  expect(evaluated('let x: string = "outer"; let inside = ""; if (uint8(1) is let x: uint8) { inside = String(x); } inside + ":" + x;')).toBe('1:outer');
  expect(evaluated('let x: string = "outer"; let inside = ""; if (uint8(1) is [let x]) { inside = String(x); } inside + ":" + x;')).toBe(':outer');
});

test('negation and short circuiting expose only successful pattern bindings', () => {
  expect(evaluated('let result = ""; if (!(uint8(1) is let x)) {} else { result = String(x); } result;')).toBe('1');
  expect(evaluated('(uint8(1) is let x) && String(x);')).toBe('1');
  expect(evaluated('!(uint8(1) is let x) || String(x);')).toBe('1');
  expectStaticTypeError('function f() { (uint8(1) is let x) || String(x); }');
  expectStaticTypeError('function f() { if (!(uint8(1) is let x)) { return x; } }');
});

test('while matches create fresh cells retained by closures', () => {
  expect(evaluated('let n: uint8 = 0; let callbacks = []; while ((n += 1) is let x: uint8 and 1..<3) { callbacks.push(() => String(x)); } callbacks[0]() + callbacks[1]();')).toBe('12');
});

test('for updaters keep their current iteration environment', () => {
  expect(evaluated('let callbacks = []; for (let i = 0; i < 2 && uint8(i) is let x; i++) { callbacks.push(() => String(x)); } callbacks[0]() + callbacks[1]();')).toBe('01');
});

test('dynamic evaluation also observes immutable pattern bindings', () => {
  expectThrownKind('if (uint8(1) is let x) { eval("x = 2"); }', 'TypeError');
});

test('alternative retries discard partial bindings without repeating property reads', () => {
  expect(evaluated('let calls = 0; let subject = { get x() { calls++; return 2; } }; let result = ""; if (subject is {x: let x and 1} or {x: let x}) { result = String(x); } result + ":" + calls;')).toBe('2:1');
  expect(evaluated('match({x:2}) { when {x: const x and 1} or {x: const x}: String(x); default: "miss"; };')).toBe('2');
});

test('a binding shared by alternatives retains both possible types', () => {
  expectStaticTypeError('function f(v: any) { if (v is let x: uint8 or let x: string) { let n: uint8 = x; } }');
});

test('for tests and update positions use the declaration variant of the grammar', () => {
  expect(evaluated('let i = 0; let result = ""; for (; i < 2 && uint8(i) is let x; i++) { result += String(x); } result;')).toBe('01');
  expect(evaluated('let result = ""; for (var i = 0; i < 2 && uint8(i) is let x; result += String(x), i++) {} result;')).toBe('01');
});
