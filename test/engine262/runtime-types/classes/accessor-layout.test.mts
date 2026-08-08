import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * PLAN-accessor.md stage C: layout participation.
 *
 * §2.1 asked whether an `accessor` occupies a layout slot, because README says
 * both things twenty lines apart - the backing field "participates in the
 * memory layout", and "a field occupies a slot in the base's memory layout and
 * an accessor doesn't". A third sentence settles it, and it is the one neither
 * side of the contradiction quotes:
 *
 *   "Private fields participate in the memory layout EXACTLY AS PUBLIC FIELDS
 *   DO, which is why the value type rule counts both."
 *
 * An `accessor` desugars to a private typed field, private fields are laid out,
 * therefore the backing is laid out. The "an accessor doesn't" sentence is
 * about a `get`/`set` PAIR, which genuinely has no storage, in a section about
 * accessors in general.
 *
 * SO STAGE C IS NOT AN ACCESSOR FEATURE. What it fixed is that a PRIVATE TYPED
 * FIELD had been treated as an untyped one - a single `#x: uint8` gave its whole
 * class no layout, and every offset and byteLength on it threw. The accessor
 * followed for free, which is the same dividend stage B had: the desugaring is
 * real, so the general rule carries it.
 */

test('a private typed field is laid out exactly as a public one', () => {
  // The three-way comparison IS the assertion. A byteLength on its own would
  // pass against a slot allocated at the end; the offset of the field AFTER the
  // private one is what says the slot sits where the declaration does.
  const publicMiddle = 'class A { a: uint8; b: uint32; c: uint8; } ';
  const privateMiddle = 'class A { a: uint8; #b: uint32; c: uint8; } ';
  const noMiddle = 'class A { a: uint8; c: uint8; } ';
  const size = 'String((type A).byteLength);';
  const offsetOfC = 'String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("c").offset);';
  expect(evaluated(publicMiddle + size)).toBe('12');
  expect(evaluated(privateMiddle + size)).toBe('12');
  expect(evaluated(publicMiddle + offsetOfC)).toBe('8');
  expect(evaluated(privateMiddle + offsetOfC)).toBe('8');
  // And the control that gives those numbers meaning: without the middle field
  // the class is two bytes and `c` is at 1.
  expect(evaluated(noMiddle + size)).toBe('2');
  expect(evaluated(noMiddle + offsetOfC)).toBe('1');
});

test('a private field is laid out and still invisible to reflection', () => {
  // README's other half: "a `#` field is a runtime-hard boundary ... invisible
  // to bracket access and reflection". The slot is real and the NAME is not
  // reachable - which is why the layout key stays the Private Name rather than
  // becoming its description: every reflection lookup compares against a
  // string, so a Private Name occupies its slot and answers no lookup.
  expectThrownKind('class A { a: uint8; #b: uint32; } Reflect.getReflection.<Reflect.ClassField, A>("#b");', 'TypeError');
  expectThrownKind('class A { a: uint8; #b: uint32; } Reflect.getReflection.<Reflect.ClassField, A>("b");', 'TypeError');
  // A base and a derived class may each declare `#x`, and they are distinct
  // Private Names - so both take slots rather than colliding, which a
  // description-keyed layout would have got wrong.
  expect(evaluated('class B { #x: uint32; } class D extends B { #x: uint32; y: uint8; } String((type D).byteLength);')).toBe('12');
});

test('an ACCESSOR occupies its slot, which is stage C\'s question', () => {
  // The discriminating assertion PLAN-accessor.md asked for: an accessor
  // between two fields, and the offset of the one after it.
  const withAccessor = 'class A { a: uint8; accessor b: uint32 = 0; c: uint8; } ';
  expect(evaluated(`${withAccessor} String((type A).byteLength);`)).toBe('12');
  expect(evaluated(`${withAccessor} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("c").offset);`)).toBe('8');
  // Identical to the public and private forms above: "participates in the
  // memory layout" means the same layout, not a layout of its own.
  expect(evaluated('class A { a: uint8; b: uint32; c: uint8; } String((type A).byteLength);')).toBe('12');
  // The accessor still works while occupying it, so the slot is the storage and
  // not a separate allocation beside it.
  expect(evaluated(`${withAccessor} const o = new A(); o.b = 7; String(o.b) + "/" + String(o.a);`)).toBe('7/0');
});

test('an SoA over a class with a private slot is REFUSED', () => {
  // The consequence of laying private fields out, and it has to be faced rather
  // than left to produce wrong bytes. An SoA reads and writes each column BY
  // NAME; a private slot has no name to reach it by, so a class carrying one has
  // no column form. Refused at construction rather than split into columns one
  // of which nothing could ever fill.
  expectThrownKind('class P { a: uint8; #b: uint32; } const s = new SoA.<P>(4);', 'TypeError');
  // A class of only public fields is unaffected, which is what says the refusal
  // is about the private slot and not about the change.
  expect(evaluated('class P { a: uint8; b: uint32; } const s = new SoA.<P>(4); String(s.length);')).toBe('4');
});
