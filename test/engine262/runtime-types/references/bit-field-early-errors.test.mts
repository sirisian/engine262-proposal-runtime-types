import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

const classes = [
  ['class Base { x: uint.<4>; } class C extends Base {}', 'C'],
  ['class Box<T> { x: T; }', 'Box.<uint.<4>>'],
  ['class Box<T> { x: T; } class C extends Box.<uint.<4>> {}', 'C'],
  ['class Box<T> { x: T; } class C<T> extends Box.<T> {}', 'C.<uint.<4>>'],
];

test.each(classes)('all borrow forms preserve field provenance: %s', (declarations, receiver) => {
  expect(ok(`${declarations} function valid(c: ${receiver}) { c.x; }`)).toBe(true);
  // Untyped destinations isolate borrow eligibility from the separate
  // compatibility judgment on a reference's stored value.
  for (const operation of [
    'let ref r = c.x;',
    'let ref r = other; ref r = c.x;',
    'take(ref c.x);',
    'return ref c.x;',
  ]) {
    expectStaticTypeError(`${declarations} function take(ref n) {} function unused(c: ${receiver}, other) { ${operation} }`);
    const byteSized = `${declarations} function take(ref n) {} function valid(c: ${receiver}, other) { ${operation} }`.replaceAll('uint.<4>', 'uint8');
    expect(ok(byteSized)).toBe(true);
  }
});

test('computed names retain the same storage field', () => {
  expectStaticTypeError('class Base { x: uint.<4>; } class C extends Base {} function unused(c: C) { let ref r = c[("x")]; }');
});

test('byte-sized inherited and specialized fields remain borrowable', () => {
  expect(evaluated('class Base { x: uint8 = 1; } class C extends Base {} let c = new C(); let ref r = c.x; r = 2; String(c.x);')).toBe('2');
  expect(evaluated('class Box<T> { x: T; } let c = new Box.<uint8>(); let ref r = c.x; r = 2; String(c.x);')).toBe('2');
});

test('small structural properties are locations without packed field layout', () => {
  expect(evaluated('let o: { x: uint.<4> } = { x: 1 }; let ref r = o.x; r = 2; String(o.x);')).toBe('2');
});

test('unbound fields and unknown receivers keep runtime borrow checks', () => {
  expect(ok('class Box<T> { x: T; } function unused<T>(c: Box.<T>) { let ref r = c.x; }')).toBe(true);
  expectThrownKind('class Base { x: uint.<4>; } class C extends Base {} function take(c: any) { let ref r = c.x; } take(new C());', 'TypeError');
});
