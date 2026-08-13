import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-memory-layout (Memory Layout) - layout participation. Design:
 * README.md.
 *
 * Whether an `accessor` occupies a layout slot is contested, because README says
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
 * SO THIS IS NOT AN ACCESSOR FEATURE. The rule is that a PRIVATE TYPED FIELD
 * is laid out as a public one is - treating it as untyped gives its whole
 * class no layout, and every offset and byteLength on it throws. The accessor
 * follows for free, because the desugaring is real and the general rule
 * carries it.
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

test('an ACCESSOR occupies its slot', () => {
  // The discriminating assertion: an accessor
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

// -- The layout slot reports the declared name -----------------------------------

test('an accessor\'s layout slot reports the DECLARED name', () => {
  // README says an accessor "participates in the memory layout exactly as
  // a field does". Reflecting it as one is the consistent completion: its
  // backing is an unnameable Private Name, and a slot no program can name
  // leaves a hole in a layout walk - a serializer would see bytes it could not
  // label. Not C#'s answer, whose generated `<a>k__BackingField` leaks a
  // compiler artifact into every reflective enumeration.
  const cls = 'class A { a: uint8; accessor b: uint32 = 0; c: uint8; } ';
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);`)).toBe('4');
  // The name is read through the context that NAMES an accessor.
  // #table-reflection-contexts gives `ClassField` and `ClassAccessor` as
  // distinct contexts of the Class family, and the ENUMERATING form always
  // agreed - `getReflection.<Reflect.ClassField, A>()` lists `a` and `c` and
  // not `b`. The named form used to answer here only because a member was
  // stored under its name alone, so any context found any declaration; asking
  // `ClassField` for an accessor now refuses, as the enumeration always did.
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassAccessor, A>("b").name);`)).toBe('b');
  expect(evaluated(`${cls} try { Reflect.getReflection.<Reflect.ClassField, A>("b"); "ACCEPTED"; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  // The layout itself is untouched - this names a slot, it does not move one.
  expect(evaluated(`${cls} String((type A).byteLength);`)).toBe('12');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("c").offset);`)).toBe('8');
  // A GENUINE private field keeps its invisibility: it was never reachable by
  // name, so nothing about it changed. The two cases are distinct and only one
  // was ever meant to be reached.
  expect(evaluated('class A { a: uint8; #b: uint32; } '
    + 'try { eval("Reflect.getReflection.<Reflect.ClassField, A>(\\"b\\");"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});
