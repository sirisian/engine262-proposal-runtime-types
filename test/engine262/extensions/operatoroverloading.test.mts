import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../readme/harness.mts';

/**
 * Extension coverage - operatoroverloading.md.
 *
 * The extension works the operator rules through a math library. On a class the
 * receiver is the left operand (main proposal). The binary arithmetic, bitwise,
 * shift, relational, and equality operators dispatch, and the unary operators
 * (`operator-()`, `operator!()`, `operator~()`, `operator+()`), the increment and
 * decrement operators (`++`/`--`, prefix and postfix), and compound assignment
 * (both the desugaring through the binary operator and an explicit `operator+=`)
 * dispatch too. `===`/`!==` keep strict-equality semantics. The scalar-on-the-left
 * case is deferred: it needs a `primitive` block from the primitive metadata
 * extension, so a number on the left does not find the object operator.
 */

// -- Binary arithmetic with typed parameters ----------------------------------
test('operators: a binary operator with a typed parameter dispatches', () => {
  expect(evaluated('class V { constructor(x) { this.x = (x := uint32); } operator*(rhs: uint32) { return new V(this.x * rhs); } } let v = new V(3); String((v * (2 := uint32)).x);')).toBe('6');
});

test('operators: overload resolution selects among operators of one symbol', () => {
  // two operator* declarations, V*uint32 and V*V; V*V is selected here
  expect(evaluated('class V { constructor(x) { this.x = (x := uint32); } operator*(rhs: uint32) { return new V(this.x * rhs); } operator*(rhs: V) { return new V(this.x * rhs.x); } } let a = new V(3); let b = new V(4); String((a * b).x);')).toBe('12');
});

// -- Bitwise and shift --------------------------------------------------------
test('operators: bitwise and shift operators dispatch', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator&(rhs) { return this.x & rhs.x; } } let a = new V(6); let b = new V(3); String(a & b);')).toBe('2');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<<(rhs) { return this.x << rhs; } } let a = new V(1); String(a << 3);')).toBe('8');
});

// -- Relational ---------------------------------------------------------------
test('operators: relational operators dispatch (receiver is the left operand)', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<(rhs) { return this.x < rhs.x; } } let a = new V(3); let b = new V(4); (a < b) ? "lt" : "ge";')).toBe('lt');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator>(rhs) { return this.x > rhs.x; } } let a = new V(5); let b = new V(4); (a > b) ? "gt" : "le";')).toBe('gt');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator<=(rhs) { return this.x <= rhs.x; } } let a = new V(3); let b = new V(3); (a <= b) ? "le" : "gt";')).toBe('le');
});

// -- Equality -----------------------------------------------------------------
test('operators: == and != dispatch to operator==', () => {
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return this.x === rhs.x; } } let a = new V(3); let b = new V(3); (a == b) ? "eq" : "ne";')).toBe('eq');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return this.x === rhs.x; } } let a = new V(3); let b = new V(4); (a != b) ? "ne" : "eq";')).toBe('ne');
});

test('operators: strict equality does not dispatch to operator==', () => {
  // === keeps reference semantics even when operator== is declared
  expect(evaluated('class V { constructor(x) { this.x = x; } operator==(rhs) { return true; } } let a = new V(3); let b = new V(3); (a === b) ? "same" : "diff";')).toBe('diff');
});

// -- Unary operators ----------------------------------------------------------
test('operators: operator-() makes unary minus negate', () => {
  // Target (operatoroverloading.md): `operator-(): Vector4` so `-v` negates.
  expect(evaluated('class V { constructor(x) { this.x = x; } operator-() { return new V(0 - this.x); } } let v = new V(3); let r = -v; String(r.x);')).toBe('-3');
});

test('operators: a unary operator does not collide with the binary of the same symbol', () => {
  // operator-() (0 params) and operator-(rhs) (1 param) are distinct: unary minus
  // negates while binary minus subtracts.
  const klass = 'class V { constructor(x) { this.x = x; } operator-() { return new V(0 - this.x); } operator-(rhs) { return new V(this.x - rhs.x); } } ';
  expect(evaluated(`${klass}let a = new V(3); String((-a).x);`)).toBe('-3');
  expect(evaluated(`${klass}let a = new V(7); let b = new V(2); String((a - b).x);`)).toBe('5');
});

test('operators: operator!() makes logical not dispatch', () => {
  expect(evaluated('class B { constructor(b) { this.b = b; } operator!() { return !this.b; } } let t = new B(true); (!t) ? "yes" : "no";')).toBe('no');
  expect(evaluated('class B { constructor(b) { this.b = b; } operator!() { return !this.b; } } let f = new B(false); (!f) ? "yes" : "no";')).toBe('yes');
});

test('operators: operator~() and operator+() dispatch', () => {
  expect(evaluated('class N { constructor(x) { this.x = x; } operator~() { return new N(~this.x); } } let n = new N(5); String((~n).x);')).toBe('-6');
  expect(evaluated('class P { constructor(x) { this.x = x; } operator+() { return this.x; } } let p = new P(42); String(+p);')).toBe('42');
});

test('operators: a unary operator on a plain value keeps the built-in meaning', () => {
  // no operator declared, so the numeric fallback applies
  expect(evaluated('let x = 5; String(-x);')).toBe('-5');
  expect(evaluated('class V { constructor(x) { this.x = x; } operator-() { return new V(0 - this.x); } } let a = new V(4); String((-(-a)).x);')).toBe('4');
});

// -- Increment and decrement --------------------------------------------------
test('operators: prefix ++ dispatches and yields the updated value', () => {
  const klass = 'class C { constructor(n) { this.n = n; } operator++() { return new C(this.n + 1); } } ';
  expect(evaluated(`${klass}let a = new C(5); let b = ++a; String(b.n);`)).toBe('6');
  expect(evaluated(`${klass}let a = new C(5); ++a; String(a.n);`)).toBe('6');
});

test('operators: postfix ++ dispatches and yields the original value', () => {
  const klass = 'class C { constructor(n) { this.n = n; } operator++() { return new C(this.n + 1); } } ';
  expect(evaluated(`${klass}let a = new C(5); let b = a++; String(b.n);`)).toBe('5');
  expect(evaluated(`${klass}let a = new C(5); a++; String(a.n);`)).toBe('6');
});

test('operators: prefix and postfix -- dispatch', () => {
  const klass = 'class C { constructor(n) { this.n = n; } operator--() { return new C(this.n - 1); } } ';
  expect(evaluated(`${klass}let a = new C(5); String((--a).n);`)).toBe('4');
  expect(evaluated(`${klass}let a = new C(5); let b = a--; String(b.n);`)).toBe('5');
});

test('operators: ++ on a plain number keeps the built-in meaning', () => {
  expect(evaluated('let x = 5; x++; String(x);')).toBe('6');
});

// -- Compound assignment ------------------------------------------------------
test('operators: compound assignment desugars through the binary operator', () => {
  // With only operator+ declared, `a += b` evaluates `a + b` and stores it.
  const klass = 'class V { constructor(n) { this.n = n; } operator+(rhs) { return new V(this.n + rhs.n); } } ';
  expect(evaluated(`${klass}let a = new V(5); let b = new V(3); a += b; String(a.n);`)).toBe('8');
  expect(evaluated(`${klass}let a = new V(1); let b = new V(2); a += b; a += b; String(a.n);`)).toBe('5');
});

test('operators: compound *= and -= desugar through their binary operators', () => {
  expect(evaluated('class V { constructor(n) { this.n = n; } operator*(rhs) { return new V(this.n * rhs.n); } } let a = new V(5); let b = new V(3); a *= b; String(a.n);')).toBe('15');
  expect(evaluated('class V { constructor(n) { this.n = n; } operator-(rhs) { return new V(this.n - rhs.n); } } let a = new V(9); let b = new V(4); a -= b; String(a.n);')).toBe('5');
});

test('operators: an explicit operator+= updates in place and returns the result', () => {
  // The design mutates `this` and returns it, so an alias sees the update.
  const klass = 'class V { constructor(n) { this.n = n; } operator+=(rhs) { this.n += rhs.n; return this; } } ';
  expect(evaluated(`${klass}let a = new V(5); let b = new V(3); a += b; String(a.n);`)).toBe('8');
  expect(evaluated(`${klass}let a = new V(5); let alias = a; let b = new V(3); a += b; String(alias.n);`)).toBe('8');
});

test('operators: an explicit operator+= takes precedence over the operator+ desugar', () => {
  // operator+ would add 100; the explicit operator+= is chosen instead.
  const klass = 'class W { constructor(n) { this.n = n; } operator+(rhs) { return new W(this.n + rhs.n + 100); } operator+=(rhs) { this.n += rhs.n; return this; } } ';
  expect(evaluated(`${klass}let a = new W(5); let b = new W(3); a += b; String(a.n);`)).toBe('8');
});

// -- The untyped path is unaffected -------------------------------------------
test('operators: objects without an operator keep default behaviour', () => {
  expect(evaluated('let a = {}; let b = {}; (a == b) ? "eq" : "ne";')).toBe('ne');
  expect(evaluated('const r = {} + 1; typeof r;')).toBe('string');
});

// -- An operator declared only by the right operand is reported ----------------
const V_MUL = 'class V { constructor(x) { this.x = x; } operator*(rhs) { return new V(this.x * 2); } operator+(rhs) { return new V(99); } } ';
const C_CMP = 'class C { constructor(x) { this.x = x; } operator<(rhs) { return true; } operator==(rhs) { return true; } } ';

test('operators: a value on the left that is not an object does not reach the right operand operator, and says so', () => {
  // Target: `2 * v` dispatches to the object's operator through a `primitive`
  // block on the number type. That block belongs to the primitive metadata
  // extension and is not implemented, so dispatch still keys on the left operand.
  // What the expression must not do is quietly coerce and answer anyway, which is
  // what it did before: a NaN here, and for `+` a concatenated string.
  expectThrown(V_MUL + 'let v = new V(3); 2 * v;');
  expectThrown(V_MUL + 'let v = new V(3); (2 := uint32) * v;');
  expectThrown(V_MUL + 'let v = new V(3); 2 + v;');
  // a compound assignment desugars to the binary operator and is reported too
  expectThrown(V_MUL + 'let v = new V(3); let x = 2; x *= v;');
  // the relational and equality operators key on the left operand in the same way
  expectThrown(C_CMP + 'let c = new C(1); 2 < c;');
  expectThrown(C_CMP + 'let c = new C(1); 2 == c;');
  expectThrown(C_CMP + 'let c = new C(1); 2 != c;');
  // the report names the operator and why it was not reached
  expect(evaluated(V_MUL + 'let v = new V(3); let m = ""; try { 2 * v; } catch (e) { m = String(e.message.includes("dispatch keys on the left operand")); } m;')).toBe('true');
});

test('operators: reporting the right operand case leaves every neighbouring case alone', () => {
  // the ordinary direction still dispatches
  expect(evaluated(V_MUL + 'let v = new V(3); String((v * 2).x);')).toBe('6');
  expect(evaluated(C_CMP + 'let c = new C(1); String(c < 2);')).toBe('true');
  // an object that declares no operator for this operation keeps its ordinary
  // JavaScript meaning, coercion and all
  expect(evaluated(V_MUL + 'let v = new V(3); String(2 - v);')).toBe('NaN');
  expect(evaluated('String(2 * {});')).toBe('NaN');
  expect(evaluated('let o = { valueOf() { return 5; } }; String(2 * o);')).toBe('10');
  // a String on the left keeps concatenation and string comparison, which are the
  // defined meanings there and may well be what the program wants
  expect(evaluated(V_MUL + 'let v = new V(3); ("a" + v).slice(0, 1);')).toBe('a');
  expect(evaluated(C_CMP + 'let c = new C(1); String("a" < c);')).toBe('false');
});

test('a `primitive` block declares operators on a primitive, and closes scalar-on-the-left', () => {
  // #sec-primitive-operator-blocks. The declaration PARSED and evaluated to
  // nothing before this, so a program could declare an operator, get no error,
  // and get no behaviour - which reads as support and is the worst of the
  // three outcomes.
  const decl = 'class V { constructor(x) { this.x = x; } operator *(rhs: number): V { return new V(this.x * rhs); } } '
    + 'primitive number { operator *(rhs: V): V { return new V(this * rhs.x); } } const v = new V(3); ';
  // The design closes scalar-on-the-left with a block on the number type, and
  // the diagnostic below was what stood in for it (F4): landing the block
  // REPLACES that diagnostic with dispatch rather than deleting it.
  expect(evaluated(`${decl} String((2 * v).x);`)).toBe('6');
  expect(evaluated(`${decl} String((v * 2).x);`)).toBe('6');
  // "where no definition with a body matches, the primitive operation runs" -
  // and MATCHING is on the right operand against the parameter type. Without
  // that test a block on `number` would capture every multiplication in the
  // program and fail on its own parameter.
  expect(evaluated(`${decl} String(3 * 2);`)).toBe('6');
  expect(evaluated(`${decl} String(3 + 2);`)).toBe('5');
  // "An operator body evaluates on raw values: no operator declared by any
  // block is re-entered within one." The class operator's body multiplies two
  // plain numbers, which without the rule dispatches back into the block.
  expect(evaluated(`${decl} String((v * 2).x + (2 * v).x);`)).toBe('12');
  // The diagnostic still fires where nothing declares the left operand's side.
  expectThrownKind('class W { operator *(rhs: number): W { return this; } } const w = new W(); 2 * w;', 'TypeError');
});
