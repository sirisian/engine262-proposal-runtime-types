import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

/**
 * A LITERAL-DERIVED LOOP BINDING - where inference declines.
 *
 * When an unannotated `for`-`of` binding over a range or array literal is NOT
 * inferred a type (its uses disagree, or it meets untyped arithmetic, or nothing asks
 * for one directly), it still came from untyped literals. It is marked to behave as
 * a numeric literal does at a typed BOUNDARY: accepted where a numeric value type is
 * asked for, and converted there at run time - the conversion `(0..<3).step(1)`
 * already relies on.
 *
 * Why a literal, and not an unknown type as `.step()` has: an unknown element is also
 * accepted at a `string`, where `let s: string = i` would quietly become "2". A
 * numeric literal is refused at a `string` (`let a: string = 5`), so the binding is.
 *
 * Only at a boundary. `a + i` for a `uint8` `a` is refused: arithmetic has no run-time
 * conversion point, so it would pass here and fail when run.
 */

test('a boundary accepts it, converting at run time', () => {
  expect(evaluated('const s = new Set.<uint32>(); const u = new Set.<int8>(); '
    + 'for (const i of 0..<3) { s.add(i); u.add(i); } String(Reflect.typeOf([...s][0]));')).toBe('uint.<32>');
});

test('a value out of the target\'s range is refused at run time', () => {
  // The run-time half of the element rule: 256 does not fit a `uint8`. BOTH halves
  // are asserted, because either alone passes without literal-derived bindings at
  // all - there the push is refused before the program runs, so it also "fails".
  // In a dead branch the checker still runs and the loop does not: no static error.
  const loop = 'const b: [].<uint8> = []; for (const i of 250..<260) { b.push(i); const z = i * 2; }';
  expect(ok(`if (false) { ${loop} }`)).toBe(true);
  expect(ok(loop)).toBe(false);
});

test('it is refused at a string, as a numeric literal is', () => {
  expectStaticTypeError('for (const i of 0..<3) { let s: string = i; }');
});

test('arithmetic that mixes it with a typed operand is refused', () => {
  // Uses that disagree keep the binding literal-derived; `a + i` is still refused,
  // since arithmetic has no conversion point for the run time to use.
  expectStaticTypeError('const a: uint8 = 1; const s = new Set.<uint32>(); const u = new Set.<int8>(); '
    + 'for (const i of 0..<3) { s.add(i); u.add(i); const r = a + i; }');
});

test('arithmetic with literals stays literal-derived, in either order', () => {
  expect(evaluated('const s = new Set.<uint32>(); for (const i of 0..<3) s.add(i + 1); String([...s].join(\',\'));'))
    .toBe('1,2,3');
  expect(evaluated('const s = new Set.<uint32>(); for (const i of 0..<3) s.add(1 + i); String([...s].join(\',\'));'))
    .toBe('1,2,3');
  expect(evaluated('const s = new Set.<uint32>(); for (const i of 0..<3) s.add(i * i); String([...s].join(\',\'));'))
    .toBe('0,1,4');
});

test('a declared number in the arithmetic makes it a plain number, in either order', () => {
  // THE ORDER TEST. Same-typed arithmetic returned its LEFT operand's record, so the
  // mark followed whichever operand came first: `s.add(i + n)` for a declared
  // `n: number` was accepted and `s.add(n + i)` refused. A literal settles it -
  // `s.add(5 + n)` is refused in either order - so both are refused.
  const pre = 'const n: number = 1; const s = new Set.<uint32>(); ';
  expectStaticTypeError(`${pre} for (const i of 0..<3) s.add(i + n);`);
  expectStaticTypeError(`${pre} for (const i of 0..<3) s.add(n + i);`);
});

test('a declared number is unaffected', () => {
  expectStaticTypeError('let n: number = 5; let x: uint8 = n;');
});

test('a non-literal iterable is unaffected', () => {
  expect(evaluated('const s = new Set.<uint32>(); for (const x of (0..<3).step(1)) s.add(x); String([...s].length);'))
    .toBe('3');
});
