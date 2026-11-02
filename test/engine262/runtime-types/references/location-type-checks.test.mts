import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// The negative loops require local callees: a deferred read of a replaceable
// Script-global function cannot establish a location or its referent type.
const location = 'let n: uint8 = 1; function first(): ref uint8 { return ref n; }';

test.each(['take(ref value());', '[value()] = [1];', 'for (value() in { x: 1 }) {}', 'for (value() of [(1 := uint8)]) {}', 'value()++;', 'value() = 1;'])('a known non-reference call cannot supply a location: %s', (operation) => {
  expectStaticTypeError(`function take(ref n: uint8) {} function unused() { function value(): uint8 { return 1; } ${operation} }`);
});

test.each(['take(ref first());', '[first()] = [2];', 'for (first() of [(2 := uint8)]) {}', 'first() = 2;', 'first()++;'])('a reference-returning call supplies its referent type: %s', (operation) => {
  expect(evaluated(`${location} function take(ref n: uint8) { n = 2; } ${operation} String(n);`)).toBe('2');
});

test.each(['first() = "s";', '[first()] = ["s"];', 'for (first() of ["s"]) {}', 'take(ref first());'])('stores and reborrows preserve the referent type: %s', (operation) => {
  expectStaticTypeError(`function take(ref n: string) {} function unused() { ${location} ${operation} }`);
});

test('an unknown call result stays a runtime location check', () => {
  expect(ok('function value(): any { return 1; } function unused() { value() = 2; }')).toBe(true);
  expect(evaluated(`${location} const f: any = first; f() = 2; String(n);`)).toBe('2');
});
