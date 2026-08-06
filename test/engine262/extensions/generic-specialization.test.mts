import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * A specialization's bindings reach the bodies of its declaration (spec
 * sec-generics: a parameter stands for the type or value an application binds
 * "within the body and signatures of its declaration").
 *
 * The frame captured when a function is created is pushed at
 * OrdinaryCallEvaluateBody, the single point every body dispatch passes
 * through. It was pushed in two body evaluators instead, and the bodies that
 * failed were exactly the ones with no push of their own: a field initializer
 * runs through EvaluateBody_AssignmentExpression, and reported that the
 * parameter was not defined while a method and a constructor read it.
 *
 * A static field is initialized when the class is DEFINED, so an unspecialized
 * generic class leaves one uninitialized - as it leaves a parameter-reading
 * heritage unevaluated - and the specialization initializes it.
 */

test('a value parameter reaches every body of its declaration', () => {
  expect(evaluated('class C<W: uint32> { m() { return W; } } String(new C.<4>().m());')).toBe('4');
  expect(evaluated('class C<W: uint32> { get g() { return W; } } String(new C.<4>().g);')).toBe('4');
  expect(evaluated('class C<W: uint32> { static m() { return W; } } String((C.<4>).m());')).toBe('4');
  expect(evaluated('class C<W: uint32> { constructor() { this.n = W; } } String(new C.<4>().n);')).toBe('4');
  expect(evaluated('class C<W: uint32> { m() { const f = () => W; return f(); } } String(new C.<4>().m());')).toBe('4');
});

test('a field initializer reaches the specialization', () => {
  expect(evaluated('class C<W: uint32> { f = W; } String(new C.<7>().f);')).toBe('7');
  expect(evaluated('class C<W: uint32> { static f = W; } String((C.<7>).f);')).toBe('7');
  expect(evaluated('class C<W: uint32> { #f = W; get v() { return this.#f; } } String(new C.<7>().v);')).toBe('7');
  // an initializer that is an anonymous function reading the parameter
  expect(evaluated('class C<W: uint32> { f = () => W; } String(new C.<7>().f());')).toBe('7');
  // and one reading a TYPE parameter
  expect(evaluated('class C<T> { f = (1 := T); } String(new C.<uint8>().f is uint8);')).toBe('true');
});

test('a value parameter carries the type it was declared with', () => {
  // `W: uint32` binds a uint32, not the plain number the argument was written
  // as, so a body mixing it with typed values does not report two numeric types
  expect(evaluated('class C<W: uint32> { t() { return W is uint32; } } String(new C.<4>().t());')).toBe('true');
  expect(evaluated('class C<W: uint32> { t(x: uint32) { return x * W; } }'
    + ' String(new C.<4>().t((2 := uint32)));')).toBe('8');
});

test('an unspecialized generic class stays usable', () => {
  // the declaration binds the name; the parts that depend on a parameter wait
  expect(evaluated('class C<W: uint32> { m() { return 1; } } String(new C().m());')).toBe('1');
  expect(evaluated('class C<W: uint32> { static f = W; } String(typeof C);')).toBe('function');
  // a non-generic class is untouched
  expect(evaluated('class C { f = 5; m() { return this.f; } } String(new C().m());')).toBe('5');
});

test('specializations are distinct and interned', () => {
  expect(evaluated('class C<W: uint32> { } String((C.<4>) === (C.<4>));')).toBe('true');
  expect(evaluated('class C<W: uint32> { } String((C.<4>) === (C.<8>));')).toBe('false');
  expect(evaluated('class C<W: uint32> { static f = W; }'
    + ' String((C.<4>).f) + "," + String((C.<8>).f);')).toBe('4,8');
});

test('a heritage clause reading a parameter is evaluated per application', () => {
  expect(evaluated('class C<W: uint32> extends [W].<uint8> { } String(new C.<4>().length);')).toBe('4');
  expect(evaluated('class C<W: uint32, H: uint32> extends [W * H].<uint8> { }'
    + ' String(new C.<4, 4>().length);')).toBe('16');
  expect(evaluated('class C<W: uint32, H: uint32> extends [W * H].<uint8> { }'
    + ' String(new C.<4, 4>().length) + "," + String(new C.<2, 2>().length);')).toBe('16,4');
});

test('a higher-kinded parameter keeps the nominal path', () => {
  // its argument is a generic DECLARATION, not a type, so specializing over it
  // is not this path's business - four higher-kinded tests broke when it was
  expect(evaluated('type Identity<T> = T; class B<W<_>> {}'
    + ' const b: B.<Identity> = new B.<Identity>(); String(typeof b);')).toBe('object');
});

test('the design\'s GridArray runs as written', () => {
  const GRID = 'class GridArray<W: uint32, H: uint32> extends [W * H].<uint8> {'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * W + x]; } } ';
  expect(evaluated(`${GRID}const g = new GridArray.<4, 4>(); g[2, 1] = 10; String(g[2, 1]);`)).toBe('10');
  expect(evaluated(`${GRID}String(new GridArray.<4, 4>().length);`)).toBe('16');
  // the write reached the slot the accessor computed
  expect(evaluated(`${GRID}const g = new GridArray.<4, 4>(); g[2, 1] = 10; String(g[6]);`)).toBe('10');
  // README's two-overload form
  expect(evaluated('class GridArray<W: uint32, H: uint32> extends [W * H].<uint8> {'
    + ' get operator[](i: uint32) { return ref this[i]; }'
    + ' get operator[](x: uint32, y: uint32) { return ref this[y * W + x]; } }'
    + ' const g = new GridArray.<4, 4>(); g[0] = 10; g[2, 1] = 20;'
    + ' String(g[0]) + "," + String(g[2, 1]);')).toBe('10,20');
});

test('a generic alias is unaffected', () => {
  expect(evaluated('type Sq<W: uint32> = [W * W].<uint8>; let a: Sq.<3>; "ok";')).toBe('ok');
});

test('a wrong number of type arguments is refused', () => {
  expectThrown('class C<W: uint32, H: uint32> { } new C.<4>();');
});

// -- explicit type arguments on a generic function call -----------------------
test('a call may supply its type arguments explicitly', () => {
  // the only way to supply them where there are no values to infer from
  expect(evaluated('function f<W: uint32>() { return W; } String(f.<4>());')).toBe('4');
  expect(evaluated('function f<W: uint32>(): uint32 { return W; } String(f.<4>());')).toBe('4');
  // the bound value carries its declared type, so it mixes with typed values
  expect(evaluated('function f<W: uint32>() { return W * (2 := uint32); } String(f.<4>());')).toBe('8');
  // a type parameter supplied explicitly is usable as a type
  expect(evaluated('function f<T>() { return (1 := T) is uint8; } String(f.<uint8>());')).toBe('true');
  // and a generator body started by such a call resumes under them
  expect(evaluated('function* g<W: uint32>() { yield W; } String(g.<4>().next().value);')).toBe('4');
});

test('explicit type arguments take precedence over inference', () => {
  expect(evaluated('function f<T>(v: T) { return Reflect.typeOf(v); } String(typeof f.<uint8>((1 := uint8)));')).toBe('object');
  // inference alone is unchanged
  expect(evaluated('function id<T>(v: T): T { return v; } String(id(5));')).toBe('5');
});

test('a wrong number of explicit type arguments is refused', () => {
  expectThrown('function f<W: uint32, H: uint32>() { return W; } f.<4>();');
});

test('a generator method of a specialization reads its parameters', () => {
  // the body resumes after the call that made it returned, so the context
  // carries the bindings and pushes them at each resumption
  expect(evaluated('class C<W: uint32> { *g() { yield W; } } String(new C.<4>().g().next().value);')).toBe('4');
  expect(evaluated('class C<W: uint32> { *g() { yield W; yield W; } }'
    + ' const it = new C.<4>().g(); it.next(); String(it.next().value);')).toBe('4');
});
