import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators.md stage H, the METADATA member.
 *
 * decorators.md, Metadata Inheritance: "Each member's metadata is inherited
 * through the PROTOTYPE CHAIN ... If B redeclares the field and applies its own
 * decorators, B gets a new metadata object (PROTOTYPICALLY INHERITING FROM A'S)
 * where B's decorators write their values, SHADOWING A'S WITHOUT MUTATING
 * THEM."
 *
 * So a metadata object is an ORDINARY OBJECT whose [[Prototype]] is the base
 * declaration's - which makes "symbol key lookups fall through the prototype"
 * true by construction rather than by a lookup rule written for it. It is also
 * why the metadata channel became a `partial interface` rather than a `partial
 * class` (cycle 126): an instance of a class with a typed field is not
 * extensible and could not be prototypically linked at all.
 */

test('a class context carries a metadata object', () => {
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.metadata; } @f class A {} t;')).toBe('object');
});

test('the object PERSISTS, so decorators of one declaration share it', () => {
  // The object a decorator receives IS the one that persists, not a copy - two
  // decorators on one class see one object, which is what makes metadata a
  // channel rather than a per-call scratch space.
  expect(evaluated('const k = Symbol("k"); function write(c) { c.metadata[k] = "set"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@read @write class A {} seen;')).toBe('set');
});

test('a subclass INHERITS its base\'s metadata through the prototype', () => {
  // "If A declares a field with metadata, and B extends A without redeclaring
  // that field, B inherits A's metadata as-is."
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('A');
});

test('a subclass SHADOWS without mutating, which is the assertion that matters', () => {
  // A write in B must not reach A. The discriminating form is a THIRD class
  // that also extends A and reads the key: if B's write had mutated A's object,
  // C would see "B". Reading through A itself would be weaker, since an
  // implementation could special-case the base.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'function derived(c) { c.metadata[k] = "B"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} @read class C extends A {} seen;')).toBe('A');
  // And B genuinely has its own value, so the shadowing is real rather than the
  // write being dropped.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { c.metadata[k] = "B"; seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('B');
});

test('a class with no base still has a metadata object', () => {
  expect(evaluated('const k = Symbol("k"); let seen = "?"; '
    + 'function f(c) { c.metadata[k] = "own"; seen = String(c.metadata[k]); } @f class A {} seen;')).toBe('own');
  // An unrelated class shares nothing with it.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "A"; } '
    + 'let seen = "none"; function g(c) { seen = String(c.metadata[k]); } '
    + '@f class A {} @g class B {} seen;')).toBe('undefined');
});

test('PINNED: what the metadata half does not yet do', () => {
  // 1. Only the CLASS context carries `metadata`. decorators.md gives it to
  // every context of the Class, Function, Object, and Enum families, each
  // holding an instance of its own intrinsic interface - the twenty-seven H1
  // declared.
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.metadata; } class A { @f a: uint8 = 1; } t;')).toBe('undefined');
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.metadata; } class A { @f m() {} } t;')).toBe('undefined');
  // 2. `Reflect.getMetadata` does not exist, so metadata is reachable only from
  // a decorator's context and not read back afterwards.
  expect(evaluated('typeof Reflect.getMetadata;')).toBe('undefined');
});
