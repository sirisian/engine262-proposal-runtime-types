import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// A bit-field is a member of a laid-out aggregate (#sec-requireborrowablereference), and a class is
// laid out where it is declared `value` (#sec-value-classes).
const classes = [
  ['value class Base { x: uint.<4>; } value class C extends Base {}', 'C'],
  ['value class Box<T: type extends value> { x: T; }', 'Box.<uint.<4>>'],
  ['value class Box<T: type extends value> { x: T; } value class C extends Box.<uint.<4>> {}', 'C'],
  ['value class Box<T: type extends value> { x: T; } value class C<T: type extends value> extends Box.<T> {}', 'C.<uint.<4>>'],
];

// The same declarations held by reference: no layout, so no field of them is packed.
const referenceClasses = [
  ['class Base { x: uint.<4>; } class C extends Base {}', 'C'],
  ['class Box<T: type> { x: T; }', 'Box.<uint.<4>>'],
  ['class Box<T: type> { x: T; } class C extends Box.<uint.<4>> {}', 'C'],
  ['class Box<T: type> { x: T; } class C<T: type> extends Box.<T> {}', 'C.<uint.<4>>'],
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

test.each(referenceClasses)('a small field of a class held by reference is a location: %s', (declarations, receiver) => {
  // The early judgment refused these and the borrow itself did not, the class having no layout for
  // the field to be packed into. They agree now, and with a small property of a structural object.
  for (const operation of ['let ref r = c.x;', 'let ref r = other; ref r = c.x;', 'take(ref c.x);', 'return ref c.x;']) {
    expect(ok(`${declarations} function take(ref n) {} function valid(c: ${receiver}, other) { ${operation} }`), operation).toBe(true);
  }
});

test('computed names retain the same storage field', () => {
  expectStaticTypeError('value class Base { x: uint.<4>; } value class C extends Base {} function unused(c: C) { let ref r = c[("x")]; }');
  expect(ok('class Base { x: uint.<4>; } class C extends Base {} function valid(c: C) { let ref r = c[("x")]; }')).toBe(true);
});

test('byte-sized inherited and specialized fields remain borrowable', () => {
  expect(evaluated('class Base { x: uint8 = 1; } class C extends Base {} let c = new C(); let ref r = c.x; r = 2; String(c.x);')).toBe('2');
  expect(evaluated('class Box<T: type> { x: T; } let c = new Box.<uint8>(); let ref r = c.x; r = 2; String(c.x);')).toBe('2');
  expect(evaluated('value class Base { x: uint8 = 1; } value class C extends Base {} let c = new C(); let ref r = c.x; r = 2; String(c.x);')).toBe('2');
});

test('small structural properties are locations without packed field layout', () => {
  expect(evaluated('let o: { x: uint.<4> } = { x: 1 }; let ref r = o.x; r = 2; String(o.x);')).toBe('2');
});

test('unbound fields and unknown receivers keep runtime borrow checks', () => {
  expect(ok('class Box<T: type> { x: T; } function unused<T: type>(c: Box.<T>) { let ref r = c.x; }')).toBe(true);
  expectThrownKind('value class Base { x: uint.<4>; } value class C extends Base {} function take(c: any) { let ref r = c.x; } take(new C());', 'TypeError');
  // ...and a class held by reference is borrowed from, checked or not.
  expect(evaluated('class Base { x: uint.<4> = 1; } class C extends Base {} function take(c: any) { let ref r = c.x; r = 2; return String(c.x); } take(new C());')).toBe('2');
  expect(evaluated('class Base { x: uint.<4> = 1; } class C extends Base {} function take(c: C) { let ref r = c.x; r = 2; return String(c.x); } take(new C());')).toBe('2');
});
