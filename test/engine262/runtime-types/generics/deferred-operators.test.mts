import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * TYPE OPERATORS OVER A PARAMETER, deferred and then evaluated.
 *
 * #sec-indexed-access-types names the generic-return form in its own worked
 * example - `function pluck<T, K: keyof T>(o: T, key: K): T[K]` - and it did not
 * compile. Two defects with one cause: `keyof T` over a parameter was evaluated
 * eagerly (to `never`, a parameter having no keys), and `T[K]` was deferred as an
 * opaque name that carried no operands, so a call that bound `T` and `K` had
 * nothing to substitute into. Both are now deferred records carrying their
 * operands, evaluated once substitution closes them - the treatment
 * #sec-substitutetype already gives a deferred ~application~.
 */

const P = 'type P = { a: uint8, b: string }; ';
const PLUCK = 'function pluck<T: type, K: keyof T>(o: T, key: K): T[K] { return o[key]; } ';
const O = 'let o: P = { a: (1 := uint8), b: "x" }; ';

test('E1/E2: the clause example compiles, inferred and explicit', () => {
  expect(evaluated(`${P}${PLUCK}${O}let n: uint8 = pluck(o, "a"); \`\${n}\`;`)).toBe('1');
  expect(evaluated(`${P}${PLUCK}${O}let n: uint8 = pluck.<P, "a">(o, "a"); \`\${n}\`;`)).toBe('1');
});

test('E3: keyof as a constraint, honoured after binding', () => {
  expect(evaluated(`${P}function id<T: type, K: keyof T>(k: K): K { return k; } let r: "a" = id.<P, "a">("a"); \`\${r}\`;`)).toBe('a');
});

test('E7: a union key yields a union', () => {
  expect(evaluated(`${P}${PLUCK}${O}let k: "a" | "b" = "a"; let v: uint8 | string = pluck(o, k); \`\${v}\`;`)).toBe('1');
});

test('E8, SOUNDNESS: the wrong target is refused for the real reason', () => {
  // Refused before too - but only because an opaque "T[K]" was assignable to
  // nothing. A fix that made the record too permissive would let this through;
  // the message is what shows the evaluation happened.
  expectThrown(`${P}${PLUCK}${O}let s: string = pluck(o, "a");`, '"uint.<8>" is not assignable to "string"');
});

test('E10: inside the declaration nothing is known, and nothing changes', () => {
  // The fix adds an EXIT from deferral; it must not weaken what deferral
  // refuses. `5` is not a `T[K]` for an unknown `T`, as before.
  expectThrown(`${P}function bad<T: type, K: keyof T>(o: T, key: K): T[K] { return 5; }`, 'is not assignable to "T[K]"');
});

test('E9: the non-generic forms are untouched', () => {
  expect(evaluated(`${P}\`\${type keyof P}\`;`)).toBe("'a' | 'b'");
  expect(evaluated(`${P}\`\${type P["a"]}\`;`)).toBe('uint.<8>');
  expect(evaluated('type Q = { a?: string }; `${type Q["a"]}`;')).toBe('string | undefined');
});

test('a parameter relates to its own constraint, and to itself through an assumption', () => {
  // `K <: keyof T` holds because K's constraint IS keyof T. The
  // parameter-to-parameter branch used to return false on differing names
  // before the constraint rule could run; and once it could, the assumption
  // pair it adds - `{ K, keyof T }` - was consulted when comparing `keyof T`
  // to itself and wrongly decided against. Identity is checked first now.
  expect(evaluated('function p<T: type, K: keyof T>(o: T, k: K): keyof T { return k; } `${typeof p}`;')).toBe('function');
});

test('inference keeps a literal under a deferred keyof', () => {
  // The literal-constraint rule keeps the literal where the constraint is a
  // literal type; `keyof T` is always a union of literal keys once T is known,
  // so a deferred keyof counts. Read only by kind, `'a'` widened to `string`
  // and `T[K]` evaluated to `P[string]`, which is not a member access.
  expect(evaluated(`${P}${PLUCK}${O}\`\${Reflect.typeOf(pluck(o, "a"))}\`;`)).toBe('uint.<8>');
});

test('E11: one kind for every deferred computation, and it reflects as one', () => {
  // A deferred operator is not a parameter - a parameter is identified by its
  // declaration, a derived one has none - and it is not a leaf. It is an
  // operator waiting on operands, and that is what Reflect reports, with one
  // shape for `keyof T`, `T[K]` and a builder call alike.
  const reflectReturn = (F: string) => `${F} const t = Reflect.getReflection(type F).signatures[0].return.type; const r = Reflect.getReflection(t); `
    + 'String(t) + " " + r.kind + " " + String(r.operator) + " " + r.operands.length;';
  expect(evaluated(reflectReturn('type F = <T: type>(o: T) => keyof T;'))).toBe('keyof T deferred keyof 1');
  expect(evaluated(reflectReturn('type F = <T: type, K: keyof T>(o: T, k: K) => T[K];'))).toBe('T[K] deferred indexed 2');
});

test('E12: the run time and the checker read `keyof T` alike', () => {
  // `KeyTypesOf` is the one implementation, and it defers an operand that
  // involves an unbound parameter. Before, the checker deferred and the run
  // time's annotation path fell to "anything else has no keys" - so the same
  // function type was `<T>(o: T) => keyof T` to one and `<T>(o: T) => never` to
  // the other.
  expect(evaluated('type F = <T: type>(o: T) => keyof T; String(Reflect.getReflection(type F).signatures[0].return.type);')).toBe('keyof T');
  // And a specialization still closes it.
  expect(evaluated("type P = { a: uint8, b: string }; function p<T: type, K: keyof T>(o: T, k: K): T[K] { return o[k]; } "
    + "let o: P = { a: (1 := uint8), b: 'x' }; String(p(o, 'a')) + String(p.<P, 'b'>(o, 'b'));")).toBe('1x');
});

test('C3: a wrong key is refused at compile time', () => {
  // The constraint check on an INFERRED binding. `pluck.<P, "zz">` was refused
  // statically and `pluck(o, "zz")` only at run time, because substitution
  // replaced `K: keyof T` wholesale with K's binding `'zz'` and the argument was
  // then checked against itself. The binding is now judged against the closed
  // constraint - `keyof T` at T = P is `'a' | 'b'` - before the substitution.
  expectThrown(`${P}${PLUCK}${O}pluck(o, "zz");`, '"\'zz\'" is not assignable to "\'a\' | \'b\'"');
  // And a non-key constraint, which had no static check at all.
  // The literal, not its widened base: a constrained parameter keeps what the
  // program wrote, so the message names `5` rather than `number`.
  expectThrown('function f<T: string>(x: T): T { return x; } f(5);', '"5" is not assignable to "string"');
  // A fitting literal is admitted by literal fit, and an unfitting one is now
  // refused STATICALLY - `f(300)` reached the run time before the constraint
  // kept the literal.
  expect(evaluated('function f<T: uint8>(x: T): T { return x; } `${f(200)}`;')).toBe('200');
  expectThrown('function f<T: uint8>(x: T): T { return x; } f(300);', '"300" is not assignable to "uint.<8>"');
});

test('E6: the checker\'s binding travels to the run time for a declared shape', () => {
  // The binder infers from the value it holds, and a declared type the value
  // does not carry - `q: Q` with `a?: uint8`, holding `{}` - is the checker's
  // knowledge alone. `pluck(q, "a")` compiled and then threw, T bound to `{}`
  // with no `a` among its keys. The checker now stamps its closed bindings on
  // the call and the evaluation pushes them as a frame, the way an explicit
  // `.<...>` is pushed, so the two sides bind identically.
  const PLUCK2 = 'function pluck<T: type, K: keyof T>(o: T, key: K): T[K] { return o[key]; } ';
  expect(evaluated(`type Q = { a?: uint8 }; ${PLUCK2}let q: Q = {}; let n: uint8 | undefined = pluck(q, "a"); \`\${n}\`;`)).toBe('undefined');
  expect(evaluated(`type Q = { a?: uint8 }; ${PLUCK2}let q: Q = { a: (3 := uint8) }; let n: uint8 | undefined = pluck(q, "a"); \`\${n}\`;`)).toBe('3');
  expect(evaluated(`interface I { a?: uint8; } ${PLUCK2}let q: I = {}; let n: uint8 | undefined = pluck(q, "a"); \`\${n}\`;`)).toBe('undefined');
  // Only a DECLARED SHAPE is stamped. A binding inferred from a literal is
  // where the checker and the run time already disagree in shape - the
  // checker binds a rest pack to an array of a literal union, the run time to a
  // tuple - and a builder reading the tuple's elements broke when handed the
  // array. This is the corpus test that caught it, kept here as the guard.
  expect(evaluated('function literal(v) { return Reflect.makeType({ kind: "literal", value: v, base: Reflect.typeOf(v) }); } function litval(T) { return Reflect.getReflection(T).value; } function joinResult(P, d) { return literal(Reflect.getReflection(P).elements.map(e => litval(e.type)).join(d)); } function join<D: string, P: [].<string>>(delimiter: D, ...parts: P): joinResult(P, delimiter) { return parts.join(delimiter); } Reflect.typeOf(join("-", "a", "b", "c")) === type "a-b-c" ? "ok" : "no";')).toBe('ok');
});
