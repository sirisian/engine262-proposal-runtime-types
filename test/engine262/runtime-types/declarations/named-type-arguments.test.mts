import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Spec: sec-type-expressions, `TypeArgument : BindingIdentifier ':' Type`.
//
// A type argument may name the parameter it supplies, so an application can skip
// a parameter that has a default rather than repeat it. The separator is `:`,
// matching the named ARGUMENT form of a call - `=` already means "the default if
// none is supplied" in the declaration, the opposite sense at the same position.
//
// Each parameter takes, in order: its positional argument, else the named
// argument bearing its name, else its default.

const GRID = 'type Grid<T = float64, Cols = uint8> = { t: T, c: Cols }; ';

test('a named argument reaches the parameter it names', () => {
  // The motivating case: set the last parameter, leave the first defaulted.
  expect(evaluated(`${GRID}let g: Grid.<Cols: uint16> = { t: 1.0, c: 1 }; String(g.c is uint16) + "/" + String(g.t is float64);`)).toBe('true/true');
  expect(evaluated(`${GRID}let g: Grid.<T: uint32> = { t: 1, c: 1 }; String(g.t is uint32);`)).toBe('true');
});

test('names make the order irrelevant', () => {
  // The property naming exists to provide: the same two arguments, either way
  // round, produce the same type.
  expect(evaluated(`${GRID}let a: Grid.<Cols: uint16, T: uint32> = { t: 1, c: 1 }; String(a.t is uint32) + "/" + String(a.c is uint16);`)).toBe('true/true');
  expect(evaluated(`${GRID}let a: Grid.<T: uint32, Cols: uint16> = { t: 1, c: 1 }; String(a.t is uint32) + "/" + String(a.c is uint16);`)).toBe('true/true');
});

test('positional arguments may come first', () => {
  expect(evaluated(`${GRID}let g: Grid.<float32, Cols: uint16> = { t: 1.0, c: 1 }; String(g.t is float32) + "/" + String(g.c is uint16);`)).toBe('true/true');
});

test('each rule refuses on its own', () => {
  // A name matching nothing is an error, not an ignored argument: otherwise a
  // misspelling would take the parameter's default and change what the program
  // means with no diagnostic.
  expectThrown(`${GRID}let g: Grid.<Nope: uint8> = { t: 1.0, c: 1 };`);
  // Supplied twice by name, and - the same mistake in a different hat - once by
  // position and once by name.
  expectThrown(`${GRID}let g: Grid.<T: uint8, T: uint16> = { t: 1, c: 1 };`);
  expectThrown(`${GRID}let g: Grid.<float32, T: uint8> = { t: 1, c: 1 };`);
  // A positional argument after a named one, which would make a positional
  // argument's meaning depend on the names used before it.
  expectThrown(`${GRID}let g: Grid.<Cols: uint16, float32> = { t: 1.0, c: 1 };`);
});

test('a form that declares no parameters refuses a name', () => {
  // An array type takes TypeArguments and declares none - the grammar names
  // neither its extent nor its element - so a name there can match nothing.
  expectThrown('let a: [4].<Element: uint8> = [1, 2, 3, 4];');
  expectThrown('let a: [].<Element: uint8> = [1];');
});

test('positional applications are unchanged', () => {
  // The feature must cost nothing to code that does not use it.
  expect(evaluated(`${GRID}let g: Grid.<float32> = { t: 1.0, c: 1 }; String(g.t is float32);`)).toBe('true');
  expect(evaluated(`${GRID}let g: Grid = { t: 1.0, c: 1 }; String(g.t is float64);`)).toBe('true');
  expect(evaluated('let a: [4].<uint8> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  expect(evaluated('let a: [].<uint8> = [1]; String(a.length);')).toBe('1');
  expect(evaluated('type Box<T> = { v: T }; let b: Box.<Box.<uint8>> = { v: { v: 1 } }; String(Number(b.v.v));')).toBe('1');
});
