import { test, expect } from 'vitest';
import { evaluated, expectThrown, run } from '../harness.mts';

// PLAN-in-place-conversion-non-writable.md phase 1, W1.
//
// An object type's boundary CONVERTS ITS MEMBERS IN PLACE - "a boundary is where
// a value acquires a type it did not have", and the alternative of building a new
// object "would DISCARD" the properties the type does not declare. That rationale
// is sound and is measured below: the callee receives the same object and its
// undeclared properties survive.
//
// What it assumed is that the property CAN BE WRITTEN. For a frozen object, an
// accessor with no setter, or a `writable: false` descriptor, the write faulted
// with `Cannot set property "n" on [object Object]` - a property-assignment error
// standing in for a type judgment, naming neither the type nor the reason, and
// arriving at run time.
//
// W1 refuses instead, and says why. Chosen over copying because a copy would
// break the identity the rationale relies on, and would make sharing depend on
// the argument's property descriptors.

const message = (src: string): string => {
  const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
  return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
};

const FROZEN = 'const o = Object.freeze({ n: 1 });';

// -- The refusal, at every boundary -------------------------------------------

test('a member that cannot be converted in place is refused, at every boundary', () => {
  // All five, because the conversion is one operation reached from five places
  // and a fix at one site would have left the others.
  const boundaries = [
    `interface I { n: uint32 } ${FROZEN} function f(x: I) { return 1; } f(o);`,
    `${FROZEN} let v: { n: uint32 } = o;`,
    `${FROZEN} function f(): { n: uint32 } { return o; } f();`,
    'const inner = Object.freeze({ n: 1 }); const outer = { i: inner }; let v: { i: { n: uint32 } } = outer;',
    `${FROZEN} let a: [].<{ n: uint32 }> = [o];`,
  ];
  for (const source of boundaries) {
    expect(message(source)).toContain('not writable');
    // The message names the member and the target type, which the old one named
    // neither of.
    expect(message(source)).toContain('"n"');
    expect(message(source)).toContain('uint.<32>');
  }
});

test('the fault is gone, whatever makes the property unwritable', () => {
  // Three ways to be unwritable, one answer. `Cannot set property` must not
  // reach a program from this path at all.
  const unwritable = [
    `interface I { n: uint32 } ${FROZEN} function f(x: I) { return 1; } f(o);`,
    'interface I { n: uint32 } const o = { get n() { return 1; } }; function f(x: I) { return 1; } f(o);',
    'interface I { n: uint32 } const o = {}; Object.defineProperty(o, "n", { value: 1, writable: false, enumerable: true });'
      + ' function f(x: I) { return 1; } f(o);',
  ];
  for (const source of unwritable) {
    expect(message(source)).not.toContain('Cannot set property');
    expect(message(source)).toContain('not writable');
  }
});

test('a COMPOSITE cannot be narrowed at a boundary, and says so', () => {
  // The sharpest consequence of W1, because both sides are the design's own
  // constructs: a composite is frozen from its creation (#sec-composite-types),
  // so a member needing conversion cannot acquire the narrower type.
  //
  // Pinned deliberately. It is the cost the decision accepted, and if it is ever
  // reconsidered - by copying for composites alone - this test is what records
  // that the behaviour was chosen rather than stumbled into.
  const source = 'type C = Composite.<{ n: number }>; const c = C({ n: 1 });'
    + ' function f(x: { n: uint32 }) { return 1; } f(c);';
  expect(message(source)).toContain('not writable');
  // A composite whose members ALREADY match crosses, which is why composites are
  // not broken outright.
  expect(evaluated('type C = Composite.<{ n: uint32 }>; const c = C({ n: (1 := uint32) });'
    + ' function f(x: { n: uint32 }) { return 1; } String(f(c));')).toBe('1');
});

// -- What must not have changed ------------------------------------------------

test('a conversion that was never needed is still not attempted', () => {
  // The `converted !== current` guard is what keeps most non-writable values
  // working, and the refusal must sit BEHIND it rather than in front. These
  // three passed before this change and must still.
  expect(evaluated('interface I { n: uint32 } const o = Object.freeze({ n: (1 := uint32) });'
    + ' function f(x: I) { return 1; } String(f(o));')).toBe('1');
  expect(evaluated('interface I { s: string } const o = Object.freeze({ s: "a" });'
    + ' function f(x: I) { return 1; } String(f(o));')).toBe('1');
  expect(evaluated('interface I { n: uint32 } const o = { get n() { return (1 := uint32); } };'
    + ' function f(x: I) { return 1; } String(f(o));')).toBe('1');
});

test('the write-back still does the job it was added for', () => {
  // `let o: { x: uint8 } = { x: 5 }` is the case the in-place conversion exists
  // for - before it, "a plain object never satisfied a type with a value-type
  // member". Guarding the write is the easiest way to break this, so it is
  // asserted directly, including that the member really became a value type.
  expect(evaluated('let o: { x: uint8 } = { x: 5 }; String(Number(o.x));')).toBe('5');
  expect(evaluated('let o: { x: uint8 } = { x: 5 };'
    + ' String(Reflect.getReflection(Reflect.typeOf(o.x)).kind);')).toBe('primitive');
  expect(evaluated('let o = { n: 1 }; function f(x: { n: uint32 }) { return x.n; }'
    + ' String(Number(f(o)));')).toBe('1');
});

test('the two facts the in-place rationale rests on still hold', () => {
  // Measured rather than trusted, because they are the argument against copying
  // (W3) and therefore the argument for this refusal existing at all.
  //
  // The callee receives the SAME object...
  expect(evaluated('let o = { n: 1 }; function f(x: { n: uint32 }) { return x; }'
    + ' String(f(o) === o);')).toBe('true');
  // ...and a property the type does not declare survives the crossing.
  expect(evaluated('let o = { n: 1, extra: "e" }; function f(x: { n: uint32 }) { return x.extra; }'
    + ' String(f(o));')).toBe('e');
});

test('a member admitted by an INDEX SIGNATURE fails the same way', () => {
  // It crosses the same boundary and is converted by the same steps, so it must
  // refuse the same way. This write was left throwing `Cannot set property` when
  // the declared-member one was fixed, and was found by writing the rule into
  // the specification: saying an index-signature member "crosses by the same
  // steps" made it a claim to check, and it was not yet true.
  expect(message('const o = Object.freeze({ a: 1 }); let v: { [k: string]: uint32 } = o;'))
    .toContain('not writable');
  expect(message('const o = Object.freeze({ a: 1 }); let v: { [k: string]: uint32 } = o;'))
    .not.toContain('Cannot set property');
  // ...and the two cases that must not change.
  expect(evaluated('let o = { a: 1 }; let v: { [k: string]: uint32 } = o; String(Number(v.a));')).toBe('1');
  expect(evaluated('const o = Object.freeze({ a: (1 := uint32) }); let v: { [k: string]: uint32 } = o;'
    + ' String(Number(v.a));')).toBe('1');
});

test('a missing member is still refused as a missing member', () => {
  // The other refusal in the same loop, which must keep its own message: an
  // absent property is not an unwritable one, and conflating them would send a
  // reader looking for a descriptor that is not the problem.
  expect(message('interface I { nope: uint32 } function f(x: I) { return 1; } f({ });'))
    .toContain('is not assignable to');
  expectThrown('interface I { nope: uint32 } function f(x: I) { return 1; } f({ });');
});
