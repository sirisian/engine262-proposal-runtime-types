import { test, expect } from 'vitest';
import {
  evaluated, expectError, expectThrown, expectThrownKind,
} from '../harness.mts';

/**
 * A specialization's bindings reach the bodies of its declaration (spec
 * #sec-generics: a parameter stands for the type or value an application binds
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

// -- The rest of the matrix --------------------------------------------------
test('a value parameter reaches the remaining body shapes', () => {
  // a setter, which the getter case above does not cover
  expect(evaluated('class C<W: uint32> { set s(v) { this.n = v * W; } }'
    + ' const c = new C.<4>(); c.s = (2 := uint32); String(c.n);')).toBe('8');
  // a static block, which runs when the class is DEFINED - so an unspecialized
  // generic class leaves it unrun and the specialization runs it
  expect(evaluated('class C<W: uint32> { static v; static { C.v = W; } } String((C.<4>).v);')).toBe('4');
  // a function expression nested in a method, which is a different creation
  // path from the arrow covered above
  expect(evaluated('class C<W: uint32> { m() { const f = function () { return W; }; return f(); } }'
    + ' String(new C.<4>().m());')).toBe('4');
});

test('a TYPE parameter reaches the same bodies as a value parameter', () => {
  expect(evaluated('class C<T> { m() { return (1 := T) is uint8; } } String(new C.<uint8>().m());')).toBe('true');
  expect(evaluated('class C<T> { static m() { return (1 := T) is uint8; } } String((C.<uint8>).m());')).toBe('true');
  expect(evaluated('class C<T> { constructor() { this.v = (1 := T); } }'
    + ' String(new C.<uint8>().v is uint8);')).toBe('true');
});

test('specialization identity distinguishes value and type arguments', () => {
  expect(evaluated('class C<T> { } String((C.<uint8>) === (C.<uint8>));')).toBe('true');
  expect(evaluated('class C<T> { } String((C.<uint8>) === (C.<uint16>));')).toBe('false');
  // a value argument and a type argument are different arguments
  expect(evaluated('class C<W> { } String((C.<4>) === (C.<uint8>));')).toBe('false');
});

test('a specialization satisfies an annotation naming the same application', () => {
  // the type arguments the specialization's class type carries are what make
  // this hold - without them a specialization refused its own value
  expect(evaluated('class B<T> {} const b: B.<uint8> = new B.<uint8>(); String(typeof b);')).toBe('object');
});

test('heritage that does not read a parameter is unaffected', () => {
  // only a parameter-reading heritage waits for an application
  expect(evaluated('class Base { m() { return 5; } } class C<W: uint32> extends Base { }'
    + ' String(new C.<4>().m());')).toBe('5');
  // and a generic class needs no heritage at all
  expect(evaluated('class C<W: uint32> { m() { return W; } } String(new C.<4>().m());')).toBe('4');
});

test('a specialization may itself be extended', () => {
  expect(evaluated('class C<W: uint32> { m() { return W; } } class D extends C.<4> { }'
    + ' String(new D().m());')).toBe('4');
  expect(evaluated('class C<W: uint32> extends [W].<uint8> { } class D extends C.<4> { }'
    + ' String(new D().length);')).toBe('4');
});

// -- an accessor may not declare type parameters ------------------------------
test('an accessor may not declare type parameters', () => {
  // a getter is never written as a call, so a parameter it declared could be
  // neither supplied nor inferred; a setter could infer one from the assigned
  // value, but parameterizing one half of a property and not the other would
  // leave the two halves of one construct with different rules
  expectError('class C { get p<T>() { return 1; } } "ran";');
  expectError('class C { set p<T>(v) { } } "ran";');
  expectError('const o = { get p<T>() { return 1; } }; "ran";');
  expectError('const o = { set p<T>(v) { } }; "ran";');
  expectError('class C { static get p<T>() { return 1; } } "ran";');
});

test('an accessor keeps everything else it could already do', () => {
  // an annotated getter and setter, which are unaffected
  expect(evaluated('class C { get p(): uint8 { return (5 := uint8); } } String(new C().p);')).toBe('5');
  expect(evaluated('class C { #v; set p(v: uint8) { this.#v = v; } get p() { return this.#v; } }'
    + ' const c = new C(); c.p = (5 := uint8); String(c.p);')).toBe('5');
  expectThrown('class C { set p(v: uint8) { } } const c = new C(); c.p = 300;');
  // and an accessor of a GENERIC class still reads that class's parameters:
  // the refusal is of parameters of the accessor's own, not of the class's
  expect(evaluated('class C<T> { get p() { return (1 := T) is uint8; } } String(new C.<uint8>().p);')).toBe('true');
  expect(evaluated('class C<W: uint32> { get p() { return W; } } String(new C.<4>().p);')).toBe('4');
  // a relational operator in a body is untouched, as is a property named `get`
  expect(evaluated('class C { m() { const n = 2; return 1 < n; } } String(new C().m());')).toBe('true');
  expect(evaluated('const o = { get: 1 }; String(o.get);')).toBe('1');
});

// -- a method may declare type parameters -------------------------------------
test('a method may declare type parameters', () => {
  // generics.md writes this as the illustration of a type parameter used as a
  // value; the grammar admitted it on a function but not on a method
  expect(evaluated('class C { m<W: uint32>() { return W; } } String(new C().m.<4>());')).toBe('4');
  expect(evaluated('const o = { m<W: uint32>() { return W; } }; String(o.m.<4>());')).toBe('4');
  expect(evaluated('class C { static m<W: uint32>() { return W; } } String(C.m.<4>());')).toBe('4');
  expect(evaluated('class C { m<W: uint32>() { return W; } go() { return this.m.<4>(); } } String(new C().go());')).toBe('4');
  expect(evaluated('class C { #m<W: uint32>() { return W; } go() { return this.#m.<4>(); } } String(new C().go());')).toBe('4');
  // a generator method, and a method carrying a return annotation as well
  expect(evaluated('class C { *m<W: uint32>() { yield W; } } String(new C().m.<4>().next().value);')).toBe('4');
  expect(evaluated('class C { m<W: uint32>(): uint32 { return W; } } String(new C().m.<4>());')).toBe('4');
  expect(evaluated('class C { async m<W: uint32>() { return W; } } String(typeof new C().m);')).toBe('function');
});

test('a method\'s type arguments may be explicit or inferred', () => {
  expect(evaluated('class C { m<T>() { return (1 := T) is uint8; } } String(new C().m.<uint8>());')).toBe('true');
  // inferred from the call's arguments, as for a function
  expect(evaluated('class C { t<T>(v: T) { return (1 := T) is uint8; } } String(new C().t((1 := uint8)));')).toBe('true');
  expectThrown('class C { m<W: uint32, H: uint32>() { return W; } } new C().m.<4>();');
});

test('a method\'s parameters and its class\'s coexist', () => {
  // both readable in one body
  expect(evaluated('class C<W: uint32> { m<T>() { return String(W) + ":" + String((1 := T) is uint8); } }'
    + ' String(new C.<4>().m.<uint8>());')).toBe('4:true');
  // and the method\'s shadows the class\'s where the names collide
  expect(evaluated('class C<T> { m<T>() { return (1 := T) is uint16; } }'
    + ' String(new C.<uint8>().m.<uint16>());')).toBe('true');
});

test('ordinary methods and object shorthand are untouched', () => {
  expect(evaluated('class C { m() { return 5; } } String(new C().m());')).toBe('5');
  // `{ m }` is still the shorthand it always was
  expect(evaluated('const m = 7; const o = { m }; String(o.m);')).toBe('7');
  expect(evaluated('const o = { m() { return 3; } }; String(o.m());')).toBe('3');
});

test('a method\'s own parameter may annotate its signature', () => {
  // `emit<T>(event: T)` - the shape generics.md writes - where the annotation
  // names the method's own parameter and is resolved before the body runs
  expect(evaluated('class C { m<T>(v: T) { return v; } } String(new C().m.<uint8>((5 := uint8)));')).toBe('5');
  expect(evaluated('class C { m<T>(v: T): T { return v; } } String(new C().m.<uint8>((5 := uint8)));')).toBe('5');
  // and enforced: a value of another type is refused - STATICALLY, since the
  // checker now types a generic method's parameter as its own `T` rather than
  // `any`, and an explicit `.<uint8>` with a string argument is a
  // mismatch it can see; a call the checker cannot see through still meets the
  // runtime boundary.
  expectThrown('class C { m<T>(v: T) { return v; } } new C().m.<uint8>("x");', 'not assignable');
});

test('a higher-kinded method parameter follows the function rule', () => {
  // it stands for a generic declaration rather than a type, so it is supplied
  // by explicit application and never inferred
  expect(evaluated('type Identity<T> = T; class C { m<W<_>>() { return 1; } }'
    + ' String(new C().m.<Identity>());')).toBe('1');
  expectThrownKind('class C { m<W<_>>() { return 1; } } new C().m();', 'TypeError');
});

// -- type parameter defaults --------------------------------------------------
test('a type parameter default binds where no argument is supplied', () => {
  // the binding boundary was gated on ANNOTATIONS, so a generic function with a
  // default and nothing annotated got no frame and reported that T was undefined
  expect(evaluated('function f<T = uint8>() { return (1 := T) is uint8; } String(f());')).toBe('true');
  expect(evaluated('class C { m<T = uint8>() { return (1 := T) is uint8; } } String(new C().m());')).toBe('true');
  // where it already worked, it still does
  expect(evaluated('function f<T = uint8>(v: uint8) { return (1 := T) is uint8; } String(f((1 := uint8)));')).toBe('true');
  expect(evaluated('function f<T = uint8>(): boolean { return (1 := T) is uint8; } String(f());')).toBe('true');
  // an explicit argument still wins over the default
  expect(evaluated('function f<T = uint8>() { return (1 := T) is uint16; } String(f.<uint16>());')).toBe('true');
});

test('a trailing default may be omitted from an argument list', () => {
  expect(evaluated('function f<T, U = uint8>(v: T) { return (1 := U) is uint8; }'
    + ' String(f.<uint16>((1 := uint16)));')).toBe('true');
  expect(evaluated('class C<T, U = uint8> { m() { return (1 := U) is uint8; } }'
    + ' String(new C.<uint16>().m());')).toBe('true');
  // a parameter without a default may not be omitted
  expectThrown('class C<T, U> { m() { return 1; } } new C.<uint8>().m();');
});

test('a default may name an earlier parameter', () => {
  // the trailing-only rule makes this well founded, and the default is resolved
  // with the bindings made so far in scope
  expect(evaluated('function f<T, U = [].<T>>(v: T) { let a: U = []; return "ok"; }'
    + ' String(f.<uint8>((1 := uint8)));')).toBe('ok');
  expect(evaluated('class C<T, U = [].<T>> { m() { let a: U = []; return "ok"; } }'
    + ' String(new C.<uint8>().m());')).toBe('ok');
});

test('a value parameter default binds a value of its declared type', () => {
  // `H: uint32 = 2` binds a uint32, not the plain number it was spelled as:
  // both halves of the literal move, so it satisfies its own constraint
  expect(evaluated('function f<H: uint32 = 2>() { return H; } String(f());')).toBe('2');
  expect(evaluated('function f<H: uint32 = 2>() { return H is uint32; } String(f());')).toBe('true');
  expect(evaluated('function f<W: uint32, H: uint32 = 2>() { return W * H; } String(f.<4>());')).toBe('8');
  expect(evaluated('class C<H: uint32 = 2> { m() { return H; } } String(new C().m());')).toBe('2');
});

test('a declaration whose parameters all have defaults needs no arguments', () => {
  // `new C()` is `new C.<uint8>()`, so the parts that depend on the parameter
  // are built rather than waiting for an application that never comes
  expect(evaluated('class C<T = uint8> { m() { return (1 := T) is uint8; } } String(new C().m());')).toBe('true');
  expect(evaluated('class C<T = uint8> { f = (1 := T); } String(new C().f is uint8);')).toBe('true');
  expect(evaluated('class C<W: uint32 = 4> extends [W].<uint8> { } String(new C().length);')).toBe('4');
  // and a bare `A` is a type for an alias whose parameters all have defaults
  expect(evaluated('type A<T = uint8> = [].<T>; let a: A = []; a.push((1 := uint8)); String(a.length);')).toBe('1');
  expect(evaluated('type A<T = uint8, U = [].<T>> = U; let a: A = []; String(a.length);')).toBe('0');
  // an explicit argument still overrides the default
  expect(evaluated('class C<T = uint8> { m() { return (1 := T) is uint16; } } String(new C.<uint16>().m());')).toBe('true');
});

test('a parameter without a default still needs its argument', () => {
  // one parameter lacking a default is enough to need an application
  expect(evaluated('class C<T> { m() { return 1; } } String(new C().m());')).toBe('1');
  expectThrown('type A<T> = [].<T>; let a: A;');
  expectThrown('type A<T, U = uint8> = [].<T>; let a: A;');
});

// -- A field's type at a specialization (#sec-generic-specialization) ---------
//
// Each application is a distinct type, and a field declared at a parameter
// holds the argument's type once the parameter is bound. A METHOD's parameter
// substituted and a field's did not, so the same `T` in the same class was
// enforced in one position and ignored in the other.

test('a specialized field holds the argument type', () => {
  const box = 'class Box<T> { value: T; set(v: T) { this.value = v; } } ';
  // Defaulted from the BOUND type rather than left undefined.
  expect(evaluated(`${box} const b = new Box.<uint8>(); \`\${b.value}:\${b.value is uint8}\`;`)).toBe('0:true');
  // A literal converts, as it does at any other typed field.
  expect(evaluated(`${box} const b = new Box.<uint8>(); b.value = 5; \`\${b.value}:\${b.value is uint8}\`;`)).toBe('5:true');
  // And a value the type forbids is refused - the soundness half.
  expectThrown(`${box} const b = new Box.<uint8>(); b.value = "a string";`);
  // The method position, which always worked, still does.
  expectThrown(`${box} const b = new Box.<uint8>(); b.set("a string");`);
});

test('a plain literal initializer converts to the bound type', () => {
  // The assertion that would pass spuriously against an ALREADY-TYPED
  // initializer: `value: T = (0 := uint8)` reads back as a uint8 whether or not
  // the field's type substituted, because the initializer was one already.
  expect(evaluated('class A<T> { value: T = 0; } const a = new A.<uint8>();'
    + ' `${a.value}:${a.value is uint8}`;')).toBe('0:true');
});

test('a composed field type substitutes through to its parts', () => {
  // An empty array is what ANY array type defaults to, so the default proves
  // nothing here; the element store is what says the element type bound.
  const arr = 'class Arr<T> { a: [].<T>; } ';
  expect(evaluated(`${arr} const x = new Arr.<uint8>(); String(x.a.length);`)).toBe('0');
  expectThrown(`${arr} const x = new Arr.<uint8>(); x.a[0] = "s";`);
  expect(evaluated(`${arr} const x = new Arr.<uint8>(); x.a[0] = 5; String(x.a[0] is uint8);`)).toBe('true');
});

test('two specializations do not share a field type', () => {
  // The way this fix could go wrong worse than the bug: one field type resolved
  // once and reused, so `Box.<uint8>` and `Box.<string>` would agree on what
  // they accept.
  const box = 'class Box<T> { value: T; } ';
  expect(evaluated(`${box} const u = new Box.<uint8>(); const s = new Box.<string>();`
    + ' u.value = 5; s.value = "text"; `${u.value}:${s.value}`;')).toBe('5:text');
  expectThrown(`${box} const u = new Box.<uint8>(); u.value = "s";`);
  expect(evaluated(`${box} const s = new Box.<string>(); s.value = "ok"; s.value;`)).toBe('ok');
});

test('an unspecialized generic still constructs', () => {
  // The frame the field pushes exists for exactly this case - a declaration
  // with nothing to bind its parameters to - so deferring to an active binding
  // must not disturb it.
  expect(evaluated('class U<T> { v: T; } typeof new U();')).toBe('object');
});

// -- Declaration-site variance (#sec-generic-variance) ------------------------

test('a declared parameter relates its instantiations', () => {
  const decls = 'interface P<out T> { get(): T } interface H<in T> { put(v: T): void }'
    + ' interface B<T> { get(): T } ';
  // Checked against the STRUCTURAL forms, which have had this variance by
  // inference all along - a stronger test than asserting a literal, since it
  // fails if either side drifts.
  const structural = 'type SOut<T> = { readonly get: () => T };'
    + ' type SIn<T> = { readonly put: (v: T) => void };'
    + ' type SBoth<T> = { readonly get: () => T, readonly put: (v: T) => void }; ';
  expect(evaluated(`${decls}${structural}`
    + ' `${Reflect.isAssignable(type P.<uint8>, type P.<uint8 | string>)}`'
    + ' === `${Reflect.isAssignable(type SOut.<uint8>, type SOut.<uint8 | string>)}` ? "agree" : "differ";')).toBe('agree');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type P.<uint8>, type P.<uint8 | string>));`)).toBe('true');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type P.<uint8 | string>, type P.<uint8>));`)).toBe('false');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type H.<uint8 | string>, type H.<uint8>));`)).toBe('true');
  expect(evaluated(`${decls} String(Reflect.isAssignable(type H.<uint8>, type H.<uint8 | string>));`)).toBe('false');
  // A declaration carrying no modifier is invariant, "the conservative default".
  expect(evaluated(`${decls} String(Reflect.isAssignable(type B.<uint8>, type B.<uint8 | string>));`)).toBe('false');
});

test('`out` is contextual and `in` is not', () => {
  // `in` is reserved, so it can only be a modifier. `out` is an ordinary
  // identifier and stays one - these are programs that were legal before the
  // modifier existed and must keep their meaning.
  expect(evaluated('let out = 5; String(out);')).toBe('5');
  expect(evaluated('type T1<out> = out; let a: T1.<uint8> = (1 := uint8); String(a);')).toBe('1');
  expect(evaluated('type T2<out: uint8> = out; String(typeof (type T2.<1>));')).toBe('object');
  // The marker, then a parameter named `out` - which looks like a mistake and
  // is not.
  expect(evaluated('interface Q<out out> { get(): out } String(typeof (type Q.<uint8>));')).toBe('object');
});

test('a variance declaration is checked against its positions', () => {
  // #sec-variance-static-semantics-early-errors. This is the half inference
  // cannot have: a structural type derives its variance and cannot be wrong,
  // while a declaration is a CLAIM - and an unchecked claim would readmit by
  // declaration the unsoundness #sec-isobjectsubtype refuses structurally.
  expectThrown('interface Bad<out T> { value: T }');       // writable field is ~both~
  expectThrown('interface Bad2<in T> { get(): T }');       // return is ~output~
  expectThrown('interface Bad3<out T> { put(v: T): void }'); // parameter is ~input~
  // A writable field admits neither modifier, not merely `out`.
  expectThrown('interface Bad4<in T> { value: T }');
  // The well-formed ones are untouched.
  expect(evaluated('interface Ok<out T> { get(): T; readonly r: T } String(typeof (type Ok.<uint8>));')).toBe('object');
  expect(evaluated('interface Ok2<in T> { put(v: T): void } String(typeof (type Ok2.<uint8>));')).toBe('object');
});
