import { test, expect } from 'vitest';
import { evaluated, expectThrown, run } from '../harness.mts';

// What `X.<…>` means.
//
// `Box.<{ a: uint8 }>` has two readings and the grammar separates neither: a
// generic application whose one type argument is an object type, and a metadata
// parameterization whose metadata record is that object. They are written alike
// BECAUSE A METADATA RECORD IS WRITTEN AS AN OBJECT TYPE, so no rule that reads
// the ARGUMENT can tell them apart.
//
// The rule read the argument: "one argument that resolves to an object type is
// metadata", the base never consulted. That made every generic alias applied to
// one object type unreachable, along with `Composite.<{ x: int32 }>` - written
// in the specification - and `Iterable.<ObjectType>`; and on the deferred path
// it dropped a brand in silence.
//
// The rule reads the BASE: type arguments where the base declares type parameters, a
// metadata record otherwise. This is the rule the specification already states
// for the two neighbouring ambiguities in the same bracket - type-vs-value
// arguments ("the clause on generics decides which a given parameter expects")
// and the named-argument Syntax Error ("a TypeParameter of the type or function
// being applied").

const kind = (decl: string): string => evaluated(
  `${decl} String(Reflect.getReflection(T).kind);`,
);

// -- The collisions: what the argument-kind rule made unreachable ---------------

test('a generic alias applied to ONE object type is an application', () => {
  // The headline case. Nothing about it is exotic: a one-parameter alias and an
  // object type. It was reported as a failure of NESTED application, but nesting
  // is only what PRODUCES an object type in argument position.
  expect(kind('type Box<T> = { value: T }; type T = Box.<{ a: uint8 }>;')).toBe('object');
  expect(kind('type Id<T> = T; type T = Id.<{ a: uint8 }>;')).toBe('object');
  expect(kind('type Box<T> = { value: T }; type T = Box.<Box.<uint8>>;')).toBe('object');
  // The alias spelling of the same thing, which fails for the same reason: the
  // argument RESOLVES to an object, whatever it was written as.
  expect(kind('type Box<T> = { v: T }; type Inner = Box.<uint8>; type T = Box.<Inner>;')).toBe('object');
});

test('a builtin family applied to one object type is an application', () => {
  // `Composite.<{ x: int32; y: int32 }>` is written in #sec-composite-types and
  // did not work. The implementation carried a `Composite`-shaped escape hatch
  // to get this one builtin past the rule and it failed anyway, which is the
  // clearest sign the rule was wrong rather than incomplete.
  expect(evaluated("type T = Composite.<{ x: int32, y: int32 }>; String(Reflect.getReflection(T).kind !== 'parameterized');")).toBe('true');
  expect(kind('type T = Iterable.<{ a: uint8 }>;')).toBe('object');
});

test('a brand over a type parameter SURVIVES instantiation', () => {
  // The only collision that failed in SILENCE, and the one to keep whatever
  // direction is taken. `T.<{ brand }>` cannot be decided where it is written,
  // the base being a parameter; the reading is deferred with the application.
  // It resolved as neither reading and the parameterization was simply dropped,
  // so `F.<string>` was `string` and the brand guaranteed nothing.
  //
  // The code's own comment names this shape: "A brand that silently becomes
  // its own base type-checks everywhere and guarantees nothing, which is the
  // worst shape this can fail in."
  expect(kind("type F<T> = T.<{ brand: 'B' }>; type T = F.<string>;")).toBe('parameterized');
  expect(evaluated("type F<T> = T.<{ brand: 'B' }>; type G = F.<string>;"
    + " type H = string.<{ brand: 'B' }>; String(G === H);")).toBe('true');
});

// -- What must not change ------------------------------------------------------

test('metadata still reads as metadata on every base that accepts it', () => {
  // Nine base kinds. A rule keyed on the base has to get all of them right, and
  // a rule that over-corrected toward "application" would empty the feature.
  expect(kind("type T = string.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type L = 'a'; type T = L.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type O = { a: uint8 }; type T = O.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type T = [].<uint8>.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type T = [uint8, string].<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("interface I { a: uint8 } type T = I.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type Box<T> = { v: T }; type T = Box.<uint8>.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("class C<T> { v: T; constructor(v: T) { this.v = v; } } type T = C.<uint8>.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(kind("type E = string.<{ brand: 'E' }>; type T = E.<{ brand: 'N' }>;")).toBe('parameterized');
});

test('type arguments still read as type arguments', () => {
  expect(kind('type Box<T> = { v: T }; type T = Box.<uint8>;')).toBe('object');
  expect(kind('type Box<T> = { v: T }; type T = Box.<[].<uint8>>;')).toBe('object');
  expect(kind('interface I { a: uint8 } type Box<T> = { v: T }; type T = Box.<I>;')).toBe('object');
  expect(kind('type Box<Element> = { v: Element }; type T = Box.<Element: uint8>;')).toBe('object');
  expect(kind('type T = uint.<8>;')).toBe('primitive');
  expect(kind('type T = Map.<string, uint8>;')).toBe('primitive');
});

test('ARITY stops mattering, and the two-object case is why', () => {
  // `Pair.<{a},{b}>` worked only BECAUSE arity gated the metadata rule: two
  // arguments could not be one metadata record, so it fell through to the
  // application. That gate is gone, so this has to keep working for the new
  // reason - the base declares parameters - rather than the old accident.
  expect(kind('type Pair<A, B> = { a: A, b: B }; type T = Pair.<{ x: uint8 }, { y: uint8 }>;')).toBe('object');
  expect(kind('type Pair<A, B> = { a: A, b: B }; type T = Pair.<uint8, string>;')).toBe('object');
});

test('a form with its own arguments production is untouched', () => {
  // `[4].<uint8>` and `[].<uint8>` reach |ArrayOrTupleType|, which carries
  // |TypeArguments| in its own production, so they never meet this rule. Worth
  // pinning because #sec-type-references calls arrays out as a form that takes
  // arguments WITHOUT declaring parameters - the one shape a base-keyed rule
  // would get wrong if it ever saw it.
  expect(kind('type T = [4].<uint8>;')).toBe('array');
  expect(kind('type T = [].<uint8>;')).toBe('array');
});

test('expression position is unaffected', () => {
  // `TypeArgumentsExpression` has no parallel collision: a generic function
  // applied to an object type already worked, because a call has no metadata
  // reading to be confused with.
  expect(evaluated('function f<T>(x: T): T { return x; }'
    + ' String(f.<{ a: uint8 }>({ a: (1 := uint8) }).a);')).toBe('1');
});

// -- `X.<>`, admitted so the rule costs no working spelling -------------------

test('an empty argument list applies every default', () => {
  // The rule makes `Grid.<{ brand: 'V' }>` an APPLICATION, since `Grid`
  // declares a parameter. That is the one currently-working spelling the rule
  // takes away, so `Grid.<>` is admitted alongside it: a generic all of whose
  // parameters have defaults gets a spelling for the type it denotes with
  // nothing supplied, and can therefore be branded in one further step.
  expect(kind('type Grid<T = float64> = { v: T }; type T = Grid.<>;')).toBe('object');
  expect(kind("type Grid<T = float64> = { v: T }; type T = Grid.<>.<{ brand: 'V' }>;")).toBe('parameterized');
  expect(evaluated('type Grid<T = float64> = { v: T }; type A = Grid.<>;'
    + ' type B = Grid.<float64>; String(A === B);')).toBe('true');
  // A parameter with no default is still required, and the error names it
  // rather than complaining about a metadata record.
  expectThrown('type Box<T> = { v: T }; type T = Box.<>;');
});

test('the deferred reading produces the SAME type the written form does', () => {
  // Not merely "a parameterized type": the identical interned one, so a value
  // crossing into `F.<string>` and one crossing into `string.<{ brand: 'B' }>`
  // are of one type rather than two that happen to look alike.
  expect(evaluated("type F<T> = T.<{ brand: 'B' }>; type G = F.<uint8>;"
    + " type H = uint8.<{ brand: 'B' }>; String(G === H);")).toBe('true');
  // And the brand is ENFORCED, which is the whole point of not dropping it:
  // a bare value of the base is refused, and the construction boundary works.
  expectThrown("type F<T> = T.<{ brand: 'B' }>; type G = F.<string>; let y: G = 'a';");
  expect(evaluated("type F<T> = T.<{ brand: 'B' }>; type G = F.<string>; String(G('a'));")).toBe('a');
});

test('a HIGHER-KINDED parameter is applied, not read as metadata', () => {
  // The deferred reading must not swallow this. `W` is bound to a generic
  // DECLARATION, so `W.<uint8>` is an application and has parameters left to
  // supply; only a binding with none reads its argument as metadata.
  expect(evaluated('type Identity<T> = T; class C<W<_>> { v: W.<uint8>; }'
    + " String('ok');")).toBe('ok');
});

test('an arity error names the parameter list, not the alias', () => {
  // The parameter list decides what `.<...>` MEANS, so it has to decide the
  // error too. Every arity failure reported "$1 is not a type", which is false
  // of the alias and says nothing about the application - and became actively
  // misleading once `Grid.<>` was legal, since a reader of `Box.<>` was told
  // `Box` was not a type rather than that `T` has no default to fall back on.
  const message = (src: string): string => {
    const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
    return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
  };
  expect(message('type Box<T> = { v: T }; type B = Box.<>;')).toContain('required parameter');
  expect(message('type Box<T> = { v: T }; type B = Box.<>;')).toContain('T');
  expect(message('type Pair<A, B> = { a: A, b: B }; type P = Pair.<uint8>;')).toContain('B');
  expect(message('type Box<T> = { v: T }; type B = Box.<uint8, string>;')).toContain('type arguments');
});

test('the fully-defaulted generic keeps a route to a brand', () => {
  // The two-step form worked before this rule and must still, since it is what
  // `Grid.<>` is measured against.
  expect(kind("type Grid<T = float64> = { v: T }; type T = Grid.<float64>.<{ brand: 'V' }>;")).toBe('parameterized');
});
