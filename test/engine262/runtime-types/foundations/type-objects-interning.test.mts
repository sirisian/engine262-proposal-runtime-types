import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-types-and-type-objects (Types and Type Objects),
 * #sec-structural-identity (Structural Identity).
 *
 * Type expressions evaluate to interned Type Objects - one structure, one
 * object - so alias-to-alias `===` is the identity judgment the rest of the
 * suite leans on. Aliases, shorthands, canonicalization, membership through
 * `instanceof` and `is`, structural object types, and computed types are
 * covered here at the foundation level.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

test('type aliases bind interned Type Objects', () => {
  expect(evaluated('type A = uint8; type B = uint8; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = uint8; type B = A; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = uint8; type B = uint16; A === B ? "same" : "different";')).toBe('different');
});

test('shorthands intern to their expansions', () => {
  expect(evaluated('type A = int8; type B = int.<8>; A === B ? "same" : "different";')).toBe('same');
  expect(evaluated('type A = boolean1; type B = uint.<1>; A === B ? "same" : "different";')).toBe('same');
});

test('canonicalization: flattening, deduplication, ordering, never', () => {
  expect(evaluated('type U1 = uint8 | string | uint8; type U2 = string | uint8; U1 === U2 ? "same" : "different";')).toBe('same');
  expect(evaluated('type U1 = (uint8 | string) | uint16; type U2 = uint16 | (string | uint8); U1 === U2 ? "same" : "different";')).toBe('same');
  expect(evaluated('type S = uint8 | uint8; type A = uint8; S === A ? "same" : "different";')).toBe('same');
  expect(evaluated('type N = never; type M = uint8 & never; N === M ? "same" : "different";')).toBe('same');
});

test('instanceof is IsOfType membership', () => {
  // #sec-value-types: numeric value types have their own values; a plain
  // Number is no longer a member, and membership follows the constructed
  // value's own type.
  expect(evaluated(`type T = uint8;
    ((5 := T) instanceof T) && !(5 instanceof T) && !("x" instanceof T) ? "ok" : "no";`)).toBe('ok');
  // asked as a question rather than as a guard: a test that decides a branch and
  // can never succeed is dead code and is rejected by the checker
  expect(evaluated('String((7 := uint8) instanceof uint16);')).toBe('false');
  expect(evaluated('type S = string; ("hi" instanceof S) && !(5 instanceof S) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type L = "on"; ("on" instanceof L) && !("off" instanceof L) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type U = uint8 | string; ((7 := uint8) instanceof U) && ("s" instanceof U) && !(true instanceof U) ? "ok" : "no";')).toBe('ok');
});

test('array and tuple membership', () => {
  expect(evaluated('type A = [].<number>; ([1, 2] instanceof A) && !([1, "x"] instanceof A) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type B = [].<uint8>; ([(1 := uint8), (2 := uint8)] instanceof B) && !([1, 2] instanceof B) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type F = [2].<number>; ([1, 2] instanceof F) && !([1] instanceof F) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type P = [number, string]; ([1, "a"] instanceof P) && !(["a", 1] instanceof P) ? "ok" : "no";')).toBe('ok');
});

test('unresolvable and unsupported types throw', () => {
  expectThrown('type X = notDefined;');
  expectThrown('type O = 3i;'); // imaginary literal types remain unsupported
});

test('object types are structural', () => {
  expect(evaluated(`type P = { x: number, y?: string };
    ({ x: 1 } is P) && ({ x: 1, y: "s" } is P) && !({ y: "s" } is P) && !({ x: "s" } is P) ? "ok" : "no";`)).toBe('ok');
  // A member the target's type cannot hold is refused, and so is one of the
  // WRONG TYPE. The `number` target is gated the same way at the object
  // member, the typed binding, and the array element, rather than letting
  // ToNumber answer for arbitrary sources, so this refusal holds everywhere
  // and not at this boundary alone.
  expect(evaluated('type P = { x: number }; function f() { return { x: "s" }; } try { let p: P = f(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('function s() { return "s"; } try { let x: number = s(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('function s() { return ["s"]; } try { let a: [].<number> = s(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  // A CAST is not a boundary and still converts, which is the split that makes
  // the gate safe to apply: a program that wants ToNumber's answer writes one.
  expect(evaluated('String("5" := number);')).toBe('5');
  expect(evaluated('type Q = { x: uint8 }; function f() { return { x: 300 }; } try { let q: Q = f(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  expect(evaluated('type A = { x: number }; type B = { x: number }; A === B ? "same" : "different";')).toBe('same');
});

test('function types and callability', () => {
  expect(evaluated('type F = (a: number) => string; ((x) => x) is F ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type F = (a: number) => string; (5 is F) ? "no" : "ok";')).toBe('ok');
});

test('computed array extents evaluate', () => {
  expect(evaluated('const n = 1 + 1; type F = [n].<number>; ([1, 2] instanceof F) && !([1] instanceof F) ? "ok" : "no";')).toBe('ok');
});

test('computed types call their builder', () => {
  expect(evaluated('function pick() { return uint8; } type C = pick(); C === uint8 ? "same" : "different";')).toBe('same');
  expect(evaluated('function bad() { return 5; } try { type C = bad(); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('a type member may have a computed name', () => {
  // |TypeMember| takes a |PropertyName|, which includes a
  // |ComputedPropertyName|, so the grammar has always admitted this form and
  // the parser has always built it - the EVALUATION refused it with "a computed
  // member name is not supported yet". A Property Type Record's [[Key]] is a
  // property key, a String or a Symbol, and it was a `string` in this engine,
  // so a symbol-valued name had nowhere to go.
  expect(evaluated('type S = { ["a"]: number }; ({ a: 1 } is S) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('const k = "a"; type S = { [k]: number }; ({ a: 1 } is S) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type S = { [Symbol.iterator]: number }; "ok";')).toBe('ok');
  // The member behaves as a named one does at a boundary: it is converted and
  // then checked, and a value the type cannot hold is refused.
  expect(evaluated('const k = "dyn"; function a() { return { dyn: 5 }; } let w: { [k]: uint8 } = a(); String(w.dyn is uint8);')).toBe('true');
  expect(evaluated('const k = "dyn"; function a() { return { dyn: 300 }; } try { let w: { [k]: uint8 } = a(); "no"; } catch (e) { "caught"; }')).toBe('caught');
  // A computed name that evaluates to neither a String nor a Symbol is refused
  // rather than coerced: ToPropertyKey would accept anything, and a key that
  // came from coercing a number or an object is a key the program did not
  // write.
  expect(evaluated('function t() { try { eval("type S = { [{}]: number };"); return "no"; } catch (e) { return "caught"; } } t();')).toBe('caught');
});

// -- The `type` operator's tuple and array operands ----------------------------
//
// #sec-types-in-expression-position: "The type forms whose syntax collides with
// the expression grammar cannot [be written directly]. The `type` operator
// resolves the collision by parsing its operand as a type." A tuple written
// bare is an array literal, so it needs the operator, and the operator's
// operand is a full Type.

test('a tuple operand interns like any other type', () => {
  // The point of the whole change: the operand form and the alias form are one
  // Type Object, so a builder's result can be compared against the spelling a
  // reader would write.
  expect(evaluated('type T = [uint8, uint8];'
    + ' (type [uint8, uint8]) === T ? "same" : "different";')).toBe('same');
  expect(evaluated('function pairOf(T) {'
    + ' return Reflect.makeType({ kind: "tuple", elements: [{ type: T, rest: false }, { type: T, rest: false }] }); }'
    + ' pairOf(uint8) === type [uint8, uint8] ? "same" : "different";')).toBe('same');
});

test('a tuple operand is a Type Object, and comparisons over it are not vacuous', () => {
  // Both halves matter. The operand used to evaluate to undefined, which made
  // `(type [uint8]) === (type [uint8])` true for the wrong reason - so a suite
  // that only asserted equality would have passed on undefined.
  expect(evaluated('typeof (type [uint8]);')).toBe('object');
  expect(evaluated('(type [uint8]) === (type [uint16]) ? "same" : "different";')).toBe('different');
});

test('array and fixed-extent operands intern too', () => {
  expect(evaluated('type A = [].<uint8>; (type [].<uint8>) === A ? "same" : "different";')).toBe('same');
  expect(evaluated('type F = [4].<uint8>; (type [4].<uint8>) === F ? "same" : "different";')).toBe('same');
});

test('the class 3 escape hatches keep their value reading', () => {
  // `[` and `-` belong to the operator, so a program that means the VALUE
  // parenthesizes the name. Nothing here reaches the operator.
  expect(evaluated('const type = ["a", "b"]; (type)[0];')).toBe('a');
  expect(evaluated('const type = 5; String((type) - 1);')).toBe('4');
  expect(evaluated('const o = { type: 5 }; String(o.type - 1);')).toBe('4');
  // A literal type operand, which is the reading `-` already had.
  expect(evaluated('type N = -1; (type -1) === N ? "same" : "different";')).toBe('same');
});

// -- The `type` operator's function-type operand -------------------------------
//
// #sec-types-in-expression-position resolves `type (uint8) => uint8` against
// `type (x)` with a cover grammar, refined at the token after the `)`.

test('a function-type operand interns like any other type', () => {
  expect(evaluated('type F = (uint8) => uint8;'
    + ' (type (uint8) => uint8) === F ? "same" : "different";')).toBe('same');
  expect(evaluated('type F = (x: uint8) => uint8;'
    + ' (type (x: uint8) => uint8) === F ? "same" : "different";')).toBe('same');
  expect(evaluated('type F = () => void; (type () => void) === F ? "same" : "different";')).toBe('same');
  // Parameter names are not part of a function type's identity, so the operand
  // form and the unnamed alias meet.
  expect(evaluated('type F = (uint8) => uint8;'
    + ' (type (x: uint8) => uint8) === F ? "same" : "different";')).toBe('same');
  // The operand is a full Type, so a curried result and a union parameter are
  // reached without parentheses.
  expect(evaluated('type C = (uint8) => (uint8) => uint8;'
    + ' (type (uint8) => (uint8) => uint8) === C ? "same" : "different";')).toBe('same');
  expect(evaluated('type U = (uint8 | string) => void;'
    + ' (type (uint8 | string) => void) === U ? "same" : "different";')).toBe('same');
});

test('what the refinement declines stays a call', () => {
  // Each of these is a live program that the operator must not capture: a
  // plain call, a call with a NAMED argument, and a call whose argument is an
  // arrow function.
  expect(evaluated('function type(x) { return x === uint8 ? "call" : "other"; } type (uint8);')).toBe('call');
  expect(evaluated('function type(x) { return x === uint8 ? "call" : "other"; } type (x: uint8);')).toBe('call');
  expect(evaluated('function type(f) { return typeof f; } type ((x) => x);')).toBe('function');
  // A parenthesized non-function type is not one of the two refinements.
  expect(evaluated('function type(x) { return x === uint8 ? "call" : "other"; } type (uint8);')).toBe('call');
});
