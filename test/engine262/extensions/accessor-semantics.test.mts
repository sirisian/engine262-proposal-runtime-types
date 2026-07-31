import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * PLAN-accessor.md stage B: the desugaring.
 *
 * README.md: "It desugars to a private typed field and the matching pair, so
 * the backing field participates in the memory layout, and an undecorated
 * accessor is inlined to a direct field access."
 *
 * THE DESUGARING IS REAL RATHER THAN SPECIAL-CASED, and that is what made it
 * small. The backing is an ordinary field record whose [[Name]] is a Private
 * Name, so `DefineField` initializes it per instance, applies the declared
 * type's DEFAULT where no initializer is written, and hangs the TypeObject on
 * the Private Name - which is what makes `PrivateSet` enforce the type. The
 * setter checks its argument because the field underneath it does, not because
 * this feature added a check.
 *
 * Built on `[[Fields]]` and `ClassFieldDefinitionRecord` throughout: the TC39
 * accessor's records are a reference that was read and never reached.
 */

test('an accessor round-trips, per instance', () => {
  expect(evaluated('class A { accessor a: uint32 = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 9; String(o.a);')).toBe('9');
  // THE ASSERTION THAT MATTERS FOR STORAGE: two instances do not share it. A
  // round trip on one object passes against a backing stored on the prototype,
  // which is the mistake a "private field" that is not per-instance would make.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); x.a = 1; y.a = 2; String(x.a) + "/" + String(y.a);')).toBe('1/2');
  // And the storage is PRIVATE: the instance has no own property, so the
  // backing is not reachable by name, by enumeration, or by `Object.keys`.
  expect(evaluated('class A { accessor a: uint32 = 5; } String(Object.getOwnPropertyNames(new A()).length);')).toBe('0');
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.keys(new A()));')).toBe('[]');
});

test('the accessor is TYPED, and the setter enforces it', () => {
  // The reason to write `accessor a: uint8` rather than a hand-written pair.
  // Out of range is a RangeError, not a TypeError - F12's split, and it arrives
  // through the backing field rather than through anything this stage wrote.
  expectThrownKind('class A { accessor a: uint8 = 1; } const o = new A(); o.a = 300;', 'RangeError');
  expectThrownKind('class A { accessor a: uint8 = 1; } const o = new A(); o.a = "s";', 'TypeError');
  // In range still works, so the check is a check and not a refusal.
  expect(evaluated('class A { accessor a: uint8 = 1; } const o = new A(); o.a = 255; String(o.a);')).toBe('255');
  // A typed accessor with NO initializer takes its type's default, the same
  // rule a typed field follows - not undefined.
  expect(evaluated('class A { accessor a: uint32; } String(new A().a);')).toBe('0');
  // An untyped accessor is untyped, and stores what it is given.
  expect(evaluated('class A { accessor a = 5; } const o = new A(); o.a = "s"; o.a;')).toBe('s');
});

test('the pair is a real getter and setter on the home object', () => {
  // An instance accessor's pair goes on the PROTOTYPE, where a hand-written
  // `get`/`set` pair goes, and is not enumerable.
  expect(evaluated('class A { accessor a: uint32 = 5; } const d = Object.getOwnPropertyDescriptor(A.prototype, "a"); typeof d.get + "/" + typeof d.set + "/" + String(d.enumerable);')).toBe('function/function/false');
  // A static accessor's pair goes on the CONSTRUCTOR, and its backing is the
  // constructor's - so it is one storage rather than one per instance.
  expect(evaluated('class A { static accessor count: uint32 = 3; } A.count = 7; String(A.count);')).toBe('7');
  expect(evaluated('class A { static accessor count: uint32 = 3; } const d = Object.getOwnPropertyDescriptor(A, "count"); typeof d.get + "/" + typeof d.set;')).toBe('function/function');
  // The getter reads through `this`, so it follows the receiver rather than
  // closing over one instance.
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 2; const g = Object.getOwnPropertyDescriptor(A.prototype, "a").get; String(g.call(o));')).toBe('2');
});

test('an accessor initializes where a field does, in declaration order', () => {
  // The initializer runs per instance, in source order AMONG THE FIELDS - so an
  // accessor between two fields runs between them. Asserting the whole sequence
  // catches an implementation that ran all fields and then all accessors, which
  // a check on the accessor alone would not.
  const order = 'const l = []; function t(n) { l.push(n); return n; } '
    + 'class A { a: uint8 = t(1); accessor b: uint8 = t(2); c: uint8 = t(3); } new A(); ';
  expect(evaluated(`${order} l.join(",");`)).toBe('1,2,3');
  // And it runs once per instance, not once per class.
  expect(evaluated(`${order} new A(); l.join(",");`)).toBe('1,2,3,1,2,3');
  // The initializer sees `this`, as a field's does.
  expect(evaluated('class A { a: uint8 = 4; accessor b: uint8 = this.a; } String(new A().b);')).toBe('4');
});

test('PINNED: what stage B does not do', () => {
  // 1. CLOSED: a PRIVATE accessor works - see the test below.

  // 2. CLOSED by stage E: a decorated accessor fires with `ClassAccessor`.
  // accessor-context.test.mts owns the assertions.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } class A { @f accessor a: uint32 = 5; } k;')).toBe('ClassAccessor');

  // 3. Nothing here asserts LAYOUT. Whether the backing occupies a slot is
  // stage C, and it is blocked on §2.1 - README says the backing "participates
  // in the memory layout" and, twenty lines later, that "an accessor doesn't"
  // occupy one. The backing is a private field today, so whatever a private
  // field does is what it does, and that is deliberately not pinned here.
});


test('a PRIVATE accessor desugars to a backing field AND a private pair', () => {
  // PLAN-accessor.md §2.3, settled. "A private field plus a public pair"
  // becomes a private field plus a PRIVATE pair - two Private Names for one
  // declaration - and the pair is a PrivateElement rather than a property, so
  // one evaluation yields two things: it RETURNS the field record, which
  // allocates the backing slot, and CARRIES the pair for the class to install
  // beside every other private element.
  expect(evaluated('class A { accessor #p: int32 = 7; } "ok";')).toBe('ok');
  expect(evaluated('class A { accessor #p: int32 = 7; get v() { return this.#p; } } String(new A().v);')).toBe('7');
  expect(evaluated('class A { accessor #p: int32 = 7; set w(x) { this.#p = x; } get v() { return this.#p; } } '
    + 'const a = new A(); a.w = 9; String(a.v);')).toBe('9');
  // THE TYPE IS ENFORCED, which is the point of the desugaring being REAL: the
  // backing is an ordinary typed field on a Private Name, so `PrivateSet` does
  // the checking and the setter checks nothing itself.
  expect(evaluated('class A { accessor #p: int32 = 7; set w(x) { this.#p = x; } } '
    + 'const a = new A(); try { a.w = "s"; "NO-CHECK"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  // A STATIC private accessor works the same way.
  expect(evaluated('class A { static accessor #t: uint32 = 3; static get v() { return A.#t; } } String(A.v);')).toBe('3');
  // And nothing leaks: the backing Private Name is unnameable, so an instance
  // has no own property for it.
  expect(evaluated('class A { accessor #p: int32 = 7; } String(Object.getOwnPropertyNames(new A()).length);')).toBe('0');
  // A PUBLIC accessor is unchanged.
  expect(evaluated('class A { accessor p: int32 = 5; } String(new A().p);')).toBe('5');
});
