import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage — class operators, extension, sealed, abstract, mixins.
 * Sections: Classes and Operator Overloading, Class Extension, Sealed Classes,
 * Abstract Classes, Class Expressions and Mixins, SIMD Operators.
 *
 * Deferrals documented rather than asserted:
 *
 *  - SIMD Operators are the SIMD extension and are not exercised here.
 *  - The full operator-overloading rules (operand resolution, scalar-on-the-left,
 *    SIMD intrinsics) are the operator-overloading extension; here we verify the
 *    core dispatch: a class operator's receiver is the left operand and its
 *    parameter is the right.
 */

// ── Classes and Operator Overloading ──────────────────────────────────────────
// A class may declare an operator; the receiver is the left operand and the
// declaration's parameter is the right operand.
test('Operator Overloading: a binary operator dispatches with the left operand as receiver', () => {
  expect(evaluated('class V { constructor(x) { this.val = x; } operator+(rhs) { return this.val + rhs.val; } } let a = new V(3); let b = new V(4); String(a + b);')).toBe('7');
  expect(evaluated('class V { constructor(x) { this.val = x; } operator*(rhs) { return this.val * rhs.val; } } let a = new V(3); let b = new V(4); String(a * b);')).toBe('12');
  // the operator can return a new instance of the class
  expect(evaluated('class V { constructor(x) { this.val = x; } operator+(rhs) { return new V(this.val + rhs.val); } } let a = new V(3); let b = new V(4); String((a + b).val);')).toBe('7');
});

test('Operator Overloading: operator members parse in a class', () => {
  expect(evaluated('class V { operator+(rhs) { return this; } operator==(rhs) { return true; } operator-(rhs) { return this; } } typeof V;')).toBe('function');
  // an object without the operator keeps today's behaviour
  expect(evaluated('const r = {} + 1; typeof r;')).toBe('string');
});

// ── Sealed Classes ────────────────────────────────────────────────────────────
// A sealed class restricts extends to the declaring module; within the module a
// subclass is allowed.
test('Sealed Classes: a sealed class parses and can be extended within its module', () => {
  expect(evaluated('sealed class Node {} typeof Node;')).toBe('function');
  expect(evaluated('sealed class Node {} class Leaf extends Node {} typeof Leaf;')).toBe('function');
  // instances relate by the prototype chain
  expect(evaluated('sealed class Node {} class Leaf extends Node {} let l = new Leaf(); String(l instanceof Node);')).toBe('true');
});

// ── Abstract Classes ──────────────────────────────────────────────────────────
// An abstract class cannot be instantiated; a concrete subclass can, and super()
// runs the abstract constructor with a concrete NewTarget.
test('Abstract Classes: an abstract class cannot be instantiated directly', () => {
  expectThrown('abstract class Shape {} new Shape();');
  expectThrown('abstract class Shape { constructor() {} } new Shape();');
  expectThrown('abstract class Shape { abstract area(): number; } new Shape();');
});

test('Abstract Classes: a concrete subclass can be instantiated and implement abstract methods', () => {
  expect(bool('abstract class Shape { area() { return (1 := number); } } class Circle extends Shape {} let c = new Circle(); String(c.area() === (1 := number));')).toBe(true);
  // an abstract method is implemented by the concrete subclass
  expect(bool('abstract class Shape { abstract area(): number; } class Circle extends Shape { area() { return (5 := number); } } let c = new Circle(); String(c.area() === (5 := number));')).toBe(true);
});

// ── Class Expressions and Mixins ──────────────────────────────────────────────
// A class expression takes the same annotations; a mixin is a function taking a
// constructor and returning a class expression that extends it.
test('Class Expressions: a class expression takes annotations', () => {
  expect(evaluated('let A = class { x: uint32 = (0 := uint32); }; let a = new A(); typeof a;')).toBe('object');
  // a named class expression's name is a type inside it
  expect(evaluated('const A = class Named {}; let a = new A(); String(a instanceof A);')).toBe('true');
  // a typed field in a class expression still seals and defaults
  expect(bool('let A = class { x: uint32; }; let a = new A(); String(a.x === (0 := uint32) && !Object.isExtensible(a));')).toBe(true);
});

test('Mixins: a mixin is a function returning a class expression that extends its base', () => {
  expect(evaluated('let Mixin = (Base) => class extends Base { extra() { return "e"; } }; class Base {} let C = Mixin(Base); let c = new C(); c.extra();')).toBe('e');
  // the mixin result extends the base
  expect(evaluated('let Mixin = (Base) => class extends Base {}; class Base { base() { return "b"; } } let C = Mixin(Base); let c = new C(); c.base();')).toBe('b');
});

// ── Class Extension: partial class ────────────────────────────────────────────
// A `partial class` re-opens an existing class to add methods and operators
// (README "Class Extension").
test('Class Extension: a partial class adds methods to an existing class', () => {
  expect(evaluated('class V { x = 1; } partial class V { getX() { return this.x; } } String(new V().getX());')).toBe('1');
  // the original members remain
  expect(evaluated('class V { foo() { return "foo"; } } partial class V { bar() { return "bar"; } } let v = new V(); v.foo() + v.bar();')).toBe('foobar');
  // a static member may be added too
  expect(evaluated('class V {} partial class V { static make() { return "m"; } } V.make();')).toBe('m');
});

test('Class Extension: partial extension is available on a sealed class', () => {
  // partial adds behaviour, not cases, so it is allowed on a sealed class
  expect(evaluated('sealed class S { foo() { return 1; } } partial class S { bar() { return 2; } } String(new S().bar());')).toBe('2');
});
