import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * Extension coverage — operatoroverloading.md.
 *
 * The extension works the operator rules through a math library. On a class the
 * receiver is the left operand (main proposal). The binary arithmetic, bitwise,
 * and shift operators dispatch, and the relational (`<`,`>`,`<=`,`>=`) and
 * equality (`==`,`!=`) operators now dispatch too, with typed parameters and
 * overload resolution among several operators of the same symbol. `===`/`!==`
 * keep strict-equality semantics. The unary operators, the scalar-on-the-left
 * case, and compound assignment are deferred (capability S).
 */

// ── Binary arithmetic with typed parameters ───────────────────────────────────
test('operators: a binary operator with a typed parameter dispatches', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator*(rhs: uint32) { return new V(this.x * rhs); } } let v = new V(3); String((v * (2 := uint32)).x);')).toBe('6');
});

test('operators: overload resolution selects among operators of one symbol', () => {
  // two operator* declarations, V*uint32 and V*V; V*V is selected here
  expect(evaluated('class V { constructor(x) { this.x = x; } operator*(rhs: uint32) { return new V(this.x * rhs); } operator*(rhs: V) { return new V(this.x * rhs.x); } } let a = new V(3); let b = new V(4); String((a * b).x);')).toBe('12');
});

// ── Bitwise and shift ─────────────────────────────────────────────────────────
test('operators: bitwise and shift operators dispatch', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator&(rhs) { return this.x & rhs.x; } } let a = new V(6); let b = new V(3); String(a & b);')).toBe('2');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<<(rhs) { return this.x << rhs; } } let a = new V(1); String(a << 3);')).toBe('8');
});

// ── Relational ────────────────────────────────────────────────────────────────
test('operators: relational operators dispatch (receiver is the left operand)', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<(rhs) { return this.x < rhs.x; } } let a = new V(3); let b = new V(4); (a < b) ? "lt" : "ge";')).toBe('lt');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator>(rhs) { return this.x > rhs.x; } } let a = new V(5); let b = new V(4); (a > b) ? "gt" : "le";')).toBe('gt');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<=(rhs) { return this.x <= rhs.x; } } let a = new V(3); let b = new V(3); (a <= b) ? "le" : "gt";')).toBe('le');
});

// ── Equality ──────────────────────────────────────────────────────────────────
test('operators: == and != dispatch to operator==', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return this.x === rhs.x; } } let a = new V(3); let b = new V(3); (a == b) ? "eq" : "ne";')).toBe('eq');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return this.x === rhs.x; } } let a = new V(3); let b = new V(4); (a != b) ? "ne" : "eq";')).toBe('ne');
});

test('operators: strict equality does not dispatch to operator==', () => {
  // === keeps reference semantics even when operator== is declared
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return true; } } let a = new V(3); let b = new V(3); (a === b) ? "same" : "diff";')).toBe('diff');
});

// ── The untyped path is unaffected ────────────────────────────────────────────
test('operators: objects without an operator keep default behaviour', () => {
  expect(evaluated('let a = {}; let b = {}; (a == b) ? "eq" : "ne";')).toBe('ne');
  expect(evaluated('const r = {} + 1; typeof r;')).toBe('string');
});

// ── Documented gaps ───────────────────────────────────────────────────────────
test('operators: unary operator dispatch is deferred (documents the gap)', () => {
  // Target (operatoroverloading.md): `operator-()` makes `-v` negate. Today unary
  // minus numifies the object rather than dispatching.
  expect(evaluated('class V { constructor(x) { this.x = x; } operator-() { return new V(0 - this.x); } } let v = new V(3); let r = -v; typeof r;')).toBe('number');
});

test('operators: scalar-on-the-left is deferred (documents the gap)', () => {
  // Target: `2 * v` dispatches to the vector's operator. Today a number on the
  // left does not find the object operator (dispatch keys on the left operand),
  // so the reverse operation numifies the object.
  expect(evaluated('class V { constructor(x) { this.x = x; } operator*(rhs) { return this; } } let v = new V(3); let r = 2 * v; typeof r;')).toBe('number');
});
