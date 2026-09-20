import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

test.each([
  'function unused(x: uint8, y: uint8) { ref x = y; }',
  'function unused(x, y) { ref x = y; }',
  'function unused(y: uint8) { let x: uint8 = 1; ref x = y; }',
  'function unused(y: uint8) { var x; ref x = y; }',
  'function unused(x: uint8, y: uint8) { const ref p = x; ref p = y; }',
  'function unused(x: uint8, y: uint8) { const ref p = x; function inner() { ref p = y; } }',
  'function unused(x: uint8, y: uint8) { function inner() { ref p = y; } const ref p = x; }',
  'function unused(x: uint8, y: uint8) { let ref p = x; { let p: uint8 = 1; ref p = y; } }',
  'function unused(x: uint8, y: uint8) { let ref p = x; { ref p = y; let p: uint8 = 1; } }',
  'function unused(x: uint8, y: uint8) { let ref p = x; function inner(p: uint8) { ref p = y; } }',
  'function unused(o: { x: uint8 }, y: uint8) { const { (ref x) } = o; ref x = y; }',
  'function unused(o: { x: uint8 }, y: uint8) { let { x } = o; ref x = y; }',
  'function unused({ x }, y: uint8) { ref x = y; }',
  'function unused(y: uint8) { try {} catch (x) { ref x = y; } }',
  'function unused(a: [].<uint8>, y: uint8) { for (const ref p of a) { ref p = y; } }',
  'function unused(a: [].<uint8>, y: uint8) { for (let p of a) { ref p = y; } }',
  'function unused(ref ...xs: [].<uint8>) { let y: [].<uint8> = []; ref xs = y; }',
])('rejects a known non-rebindable destination: %s', expectStaticTypeError);

test('mutable ref locals, parameters, closures, and patterns can rebind', () => {
  expect(evaluated('let x: uint8 = 1, y: uint8 = 2; let ref p = x; ref p = y; p = 3; String(y);')).toBe('3');
  expect(evaluated('function f(ref p: uint8, ref y: uint8) { ref p = y; p = 3; } let x: uint8 = 1, y: uint8 = 2; f(ref x, ref y); String(y);')).toBe('3');
  expect(evaluated('let x: uint8 = 1, y: uint8 = 2; function inner() { ref p = y; } let ref p = x; inner(); p = 3; String(y);')).toBe('3');
  expect(evaluated('let o = { (x: uint8): 1 }; let y: uint8 = 2; let { (ref x) } = o; ref x = y; x = 3; String(y);')).toBe('3');
  expect(evaluated('let p: uint8 = 0, x: uint8 = 1, y: uint8 = 2; { let ref p = x; ref p = y; p = 3; } String(y);')).toBe('3');
  expect(ok('function unused(a: [].<uint8>, y: uint8) { for (let ref p of a) { ref p = y; } }')).toBe(true);
});

test('var redeclaration does not change a ref parameter into an ordinary binding', () => {
  expect(evaluated('function f(ref p: uint8, ref y: uint8) { var p; ref p = y; p = 3; } let x: uint8 = 1, y: uint8 = 2; f(ref x, ref y); String(y);')).toBe('3');
});

test('a reference-returning call supplies its referent type to a binding or rebinding', () => {
  const setup = 'let x: uint8 = 1, y: uint8 = 2; function second(): ref uint8 { return ref y; } ';
  expect(evaluated(`${setup}let ref p = x; ref p = second(); p = 3; String(y);`)).toBe('3');
  expect(evaluated(`${setup}let ref p: uint8 = second(); p = 3; String(y);`)).toBe('3');
  expect(evaluated(`${setup}const ref p = second(); let n: uint8 = p; String(n);`)).toBe('2');
  expect(evaluated(`${setup}let ref p = (second()); ref p = (second()); p = 3; String(y);`)).toBe('3');
  expectStaticTypeError(`${setup}let ref p = second(); p = "bad";`);
  expectStaticTypeError(`${setup}let ref p: string = second();`);
  expectStaticTypeError(`${setup}let text: string = "s"; let ref p = text; ref p = second();`);
});

test('immutable refs preserve ordinary const write restrictions', () => {
  expectThrownKind('let x: uint8 = 1; const ref p = x; p = 2;', 'TypeError');
  expect(evaluated('let o = { x: 1 }; const ref p = o; p.x = 2; String(o.x);')).toBe('2');
});

test('the alias keeps its declared type when rebound to a narrower location', () => {
  expect(ok('function unused(a: uint8 | string, b: uint8) { let ref p = a; ref p = b; p = "s"; }')).toBe(true);
  expect(ok('function unused(a: uint8 | string, b: string) { let ref p = a; if (p is uint8) { ref p = b; } }')).toBe(true);
  expectThrownKind('let a: uint8 | string = 1, b: uint8 = 2; let ref p = a; ref p = b; p = "s";', 'TypeError');
});

test('unresolved and object-environment destinations defer to runtime', () => {
  expect(ok('function unused(y: uint8) { ref external = y; }')).toBe(true);
  expect(ok('function unused(o: any, y: uint8) { let p: uint8 = 1; with (o) { ref p = y; } }')).toBe(true);
  expectStaticTypeError('function unused(o: any, y: uint8) { with (o) { let p: uint8 = 1; ref p = y; } }');
});

test('rebinding preserves the new location and its liveness checks', () => {
  expectThrownKind('let a: [].<uint8> = [1, 2]; let ref p = a[0]; ref p = a[1]; a.length = 1; p;', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let ref p = a[0]; ref p = a[1]; a.reserve(64); p;', 'TypeError');
  expectThrownKind('let a: [].<uint8> = [1, 2]; let ref p = a[0]; ref p = a[1]; a.reserve(64); p = 3;', 'TypeError');
  expect(evaluated('let a: [].<uint8> = [1, 2]; a.reserve(64); let ref p = a[0]; ref p = a[1]; a.push(3); p = 4; String(a[1]);')).toBe('4');
});

test('rebinding an SoA element keeps a live view rather than a gathered copy', () => {
  const setup = 'class C { x: uint8; } const a = new SoA.<C>(); a.push({ x: 1 }); a.push({ x: 2 }); let ref p = a[0]; ref p = a[1]; ';
  expect(evaluated(`${setup}p.x = 3; String(a[1].x);`)).toBe('3');
  expectThrownKind(`${setup}a.reserve(64); p.x;`, 'TypeError');
  expectThrownKind(`${setup}a.pop(); p.x;`, 'TypeError');
});

test('a returned stale borrow is not refreshed by rebinding or re-borrowing', () => {
  const setup = 'function stale(a: [].<uint8>): ref uint8 { try { return ref a[0]; } finally { a.reserve(64); } } let a: [].<uint8> = [1]; let x: uint8 = 0; let ref p = x; ';
  expectThrownKind(`${setup}ref p = stale(a); p;`, 'TypeError');
  expectThrownKind(`${setup}let ref q = stale(a); q;`, 'TypeError');
});
