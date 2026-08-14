import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// `[].<T>` in expression position evaluates to a CONSTRUCTOR, not to the interned
// Type Object it is keyed on, so `isTypeObject` - which is `'TypeRecord' in
// value` - answered false and `Reflect.getReflection([].<uint32>)` threw "is not
// a type" while every other type reflected.
//
// The constructor now carries the record, which is the same shape the design
// already gives a class: "a class's type object is its constructor". That also
// gives `[].<T>.withCapacity(n)` somewhere to live - an earlier attempt attached
// it at `GetTypeObject`, which never sees an array type, and silently did
// nothing.

test('an array type reflects', () => {
  expect(evaluated('String(Reflect.getReflection([].<uint32>).kind);')).toBe('array');
  expect(evaluated('String(Reflect.getReflection([3].<uint8>).kind);')).toBe('array');
});

test('withCapacity, as the design writes it', () => {
  // README "Capacity", verbatim apart from the binding.
  expect(evaluated('const out = [].<uint32>.withCapacity(1024); out.push(7); String(out.length) + "/" + String(out.capacity >= 1024);')).toBe('1/true');
  expect(evaluated('String([].<uint32>.withCapacity(16).length);')).toBe('0');
  expect(evaluated('String([].<uint32>.withCapacity(16).capacity >= 16);')).toBe('true');
  // It carries the receiver's ELEMENT type, so a later push is checked.
  expectThrown('const o = [].<uint32>.withCapacity(4); o.push("s");');
  expect(evaluated('const o = [].<uint8>.withCapacity(4); o.push(200); String(o[0] is uint8);')).toBe('true');
  // And composes with reserve.
  expect(evaluated('const o = [].<uint32>.withCapacity(8); o.reserve(64); String(o.capacity);')).toBe('64');
});

test('what an array type already did, it still does', () => {
  // These are the behaviours a change to the type object\u2019s shape would most
  // plausibly break.
  expect(evaluated('let a: [].<uint32> = [1]; String(a instanceof [].<uint32>);')).toBe('true');
  expect(evaluated('String([].<uint32> === [].<uint32>);')).toBe('true');
  expect(evaluated('let a: [].<uint8> = [1, 2]; String(a.length);')).toBe('2');
  expectThrown('[].<uint32>();');
});
