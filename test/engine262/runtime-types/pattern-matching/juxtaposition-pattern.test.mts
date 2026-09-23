import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-match-patterns.
 *
 *     MatchPrimaryPattern :
 *       MatchNamePattern ( MatchPatternList? )     the extractor
 *       MatchNamePattern ObjectMatchPattern        juxtaposition, object
 *       MatchNamePattern ArrayMatchPattern         juxtaposition, array
 *
 * The engine parsed the first and neither of the others, so `when P { x: let n }`
 * was a *SyntaxError* though both halves existed separately.
 *
 * The clause never says what a juxtaposition MATCHES. The overlap rule settles
 * it: a |MatchNamePattern| and a |Type| "overlap where a name is both; the name
 * form is preferred, and THE TWO READINGS AGREE wherever both exist, since a
 * name denoting a type matches by membership under either". So `P` tests
 * membership and `P { ... }` must agree with `P` - membership first, then the
 * shape.
 *
 * Only the BRACED form is taken. `MatchNamePattern ArrayMatchPattern` is
 * ambiguous with an |IndexedAccessType| after a name, where the two readings do
 * NOT agree, so the overlap rule does not reach it; the baselines below pin what
 * the bracketed spellings do today so a later decision starts from fact.
 */

const P = 'class P { x: uint8 = (1 := uint8); y: uint8 = (2 := uint8); } let v: any = new P(); ';

test('a juxtaposition binds through its shape', () => {
  expect(evaluated(`${P}let r = match (v) { when P { x: let n }: n; default: 0; }; String(r);`)).toBe('1');
  expect(evaluated(`${P}let r = match (v) { when P { x: 1, y: 2 }: "y"; default: "n"; }; r;`)).toBe('y');
  expect(evaluated(`${P}let r = match (v) { when P { x: _ }: "y"; default: "n"; }; r;`)).toBe('y');
  expect(evaluated(`${P}let r = match (v) { when P { ...let rest }: "y"; default: "n"; }; r;`)).toBe('y');
  expect(evaluated('class Q { inner: any = { y: (3 := uint8) }; } let v: any = new Q(); '
    + 'let r = match (v) { when Q { inner: { y: let m } }: m; default: 0; }; String(r);')).toBe('3');
});

test('the head is a membership test, which is the point of writing it', () => {
  // A value of the same SHAPE but a different type does not match. Without the
  // head's test this would be indistinguishable from a bare object pattern.
  expect(evaluated('class P { x: uint8 = (1 := uint8); } class Q { x: uint8 = (1 := uint8); } '
    + 'let v: any = new Q(); let r = match (v) { when P { x: let n }: "y"; default: "n"; }; r;')).toBe('n');
});

test('`P {}` agrees with `P`, which is the overlap rule holding', () => {
  expect(evaluated(`${P}let a = match (v) { when P {}: 1; default: 0; }; `
    + 'let b = match (v) { when P: 1; default: 0; }; String(a) + String(b);')).toBe('11');
});

test('every spelling of a MatchNamePattern heads it', () => {
  expect(evaluated('const Ns = { P: class { x: uint8 = (1 := uint8); } }; let v: any = new Ns.P(); '
    + 'let r = match (v) { when Ns.P { x: let n }: n; default: 0; }; String(r);')).toBe('1');
  expect(evaluated('class Box<T: type> { v: T | null = null; } let b: any = new Box.<uint8>(); '
    + 'let r = match (b) { when Box.<uint8> { v: _ }: "y"; default: "n"; }; r;')).toBe('y');
  expect(evaluated('interface I { x: uint8; } let v: any = { x: (1 := uint8) }; '
    + 'let r = match (v) { when I { x: let n }: n; default: 0; }; String(r);')).toBe('1');
});

test('a head that denotes a value is the type error the clause states', () => {
  // "It is a type error if the |MatchNamePattern| of a juxtaposition or of an
  // extractor form resolves to a binding: the juxtaposed head must denote a
  // TYPE." That rule had nothing to enforce it while the form did not parse.
  //
  // Decided AT RUN TIME, which is the half of the clause that applies here:
  // "at the site where the head's Static Type is known and at run time
  // otherwise". It is otherwise - measured, a head naming a value binding and
  // one naming a class through a namespace object both resolve to *null*
  // statically, so no test in the checker separates them.
  expectThrownKind('let Foo = 5; let v: any = {}; match (v) { when Foo { x: let n }: 1; default: 0; };', 'TypeError');
  expectThrownKind('let Foo: uint8 = (5 := uint8); let v: any = {}; '
    + 'match (v) { when Foo { x: let n }: 1; default: 0; };', 'TypeError');
  // The extractor's half of the same sentence is unchanged, and IS static.
  expectStaticTypeError('let Foo: uint8 = (5 := uint8); let v: any = 5; '
    + 'match (v) { when Foo(let a): 1; default: 0; };');
});

test('it composes with the rest of the pattern grammar', () => {
  expect(evaluated(`${P}let r = match (v) { when P { x: let n } if (n > 0): n; default: 0; }; String(r);`)).toBe('1');
  expect(evaluated(`${P}let r = match (v) { when not P { x: 9 }: "y"; default: "n"; }; r;`)).toBe('y');
  expect(evaluated(`${P}if (v is P { x: let n }) { String(n); } else { "no"; }`)).toBe('1');
});

test('a LineTerminator before the brace ends the pattern', () => {
  // In `is` position a pattern is an ordinary operand, so an expression
  // statement may be followed by a block. A greedy juxtaposition would swallow
  // it; the restriction keeps a pattern and a block two things.
  expect(evaluated('class P {} let v: any = new P();\nv is P\n{ "block ran"; }')).toBe('block ran');
});

test('every form that already worked is unchanged', () => {
  expect(evaluated('class P {} let v: any = new P(); let r = match (v) { when P: "y"; default: "n"; }; r;')).toBe('y');
  expect(evaluated('let v: any = { x: (1 := uint8) }; '
    + 'let r = match (v) { when { x: let n }: n; default: 0; }; String(r);')).toBe('1');
  expect(evaluated('const Some = { [Symbol.customMatcher](x) { return [x]; } }; let v: any = 5; '
    + 'let r = match (v) { when Some(let n): n; default: 0; }; String(r);')).toBe('5');
  // The braced form's existing type-or-pattern split, which the juxtaposition
  // rides on: a shape whose every member is a type stays on the type path.
  expect(evaluated('let v: any = { x: (1 := uint8) }; '
    + 'let r = match (v) { when { x: uint8 }: "y"; default: "n"; }; r;')).toBe('y');
  expect(evaluated("type T = { a: uint8 }; let v: any = (1 := uint8); "
    + 'let r = match (v) { when T[\'a\']: "y"; default: "n"; }; r;')).toBe('y');
  expect(evaluated("type T = { a: uint8 }; let x: T['a'] = (1 := uint8); String(x);")).toBe('1');
  expect(evaluated("let s = 'hi'; String('world' is Reflect.typeOf(s));")).toBe('true');
});

test('the bracketed form is claimed only where no type could be written', () => {
  // `P [x]` reads as an |IndexedAccessType| too, and unlike the overlap rule's
  // case the two readings do NOT agree - so the bracketed shape keeps the
  // speculation's own gate, admitting it only where an element is something a
  // |Type| cannot express. That test, `matchPatternNeedsPatternPath`, is purely
  // syntactic and already serves the standalone braced and bracketed forms.
  //
  // The gate falls exactly on the compatibility line: these two were a
  // *SyntaxError* and an unresolvable index before, so claiming them costs
  // nothing.
  expect(evaluated('class P extends Array {} let v: any = P.from([7]); '
    + 'let r = match (v) { when P [let a]: a; default: 0; }; String(r);')).toBe('7');
  expect(evaluated('class P extends Array {} let v: any = P.from([7]); '
    + 'let r = match (v) { when P [_]: "y"; default: "n"; }; r;')).toBe('y');
});

test('a bracket that COULD be a type keeps its indexed-access reading', () => {
  // These have meanings today and keep them, which is what the gate protects.
  expect(evaluated("type T = { a: uint8 }; let v: any = (1 := uint8); "
    + 'let r = match (v) { when T[\'a\']: "y"; default: "n"; }; r;')).toBe('y');
  expectStaticTypeError('class P {} let v: any = new P(); match (v) { when P [uint8]: 1; default: 0; };');
  expect(evaluated("type T = { a: uint8 }; let x: T['a'] = (1 := uint8); String(x);")).toBe('1');
  // And a bare tuple type pattern is untouched.
  expect(evaluated('let v: any = [(1 := uint8)]; '
    + 'let r = match (v) { when [uint8]: "y"; default: "n"; }; r;')).toBe('y');
});
