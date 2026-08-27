test('the two halves reach the SAME shapes, whatever names the base', () => {
  // This once recorded a GAP. Canonicalization reduced every disjoint
  // intersection, while the Early Error was decided over what the checking pass
  // had resolved - and that pass built a parameterized record only when the base
  // was a BUILTIN. So `string.<{ brand: 'E' }> & uint8` was diagnosed and
  // `E.<{ brand: 'N' }> & uint8` was not, the two differing only in what named
  // the base. The four shapes below were the whole of it, and they are now
  // diagnosed at the annotation like any other.
  //
  // Both spellings, since the reach never depended on which was written: the
  // inline form and the alias form resolve through the same arm.
  const N = "type E = string.<{ brand: 'E' }>; type N = E.<{ brand: 'N' }>;";
  expectThrown(`${N} type U = N & uint8;`);
  expectThrown("type U = string.<{ brand: 'E' }>.<{ brand: 'N' }> & uint8;");
  expectThrown("type Base = { a: uint8 }; type A = Base.<{ brand: 'A' }>; type U = A & uint8;");
  expectThrown("type U = { a: uint8 }.<{ brand: 'A' }> & uint8;");
  expectThrown("type Base = [].<uint8>; type A = Base.<{ brand: 'A' }>; type U = A & uint8;");
  expectThrown("type E = string.<{ brand: 'E' }>; type U = E & uint8;");
  // What must NOT be diagnosed: a base that declares type parameters is being
  // APPLIED, so its object-shaped argument is a type and not a record.
  expect(evaluated('type Box<T> = { value: T }; type U = Box.<{ a: uint8 }>;'
    + ' String(Reflect.getReflection(U).kind);')).toBe('object');
});

import { test, expect } from 'vitest';
import { evaluated, expectThrown, run } from '../harness.mts';

// #sec-aredisjoint, #sec-canonicalizetype, #sec-intersection-type-early-errors.
//
// `number & bigint` was neither `never` nor an error: it interned as its own
// two-member ~intersection~ Type Object. That type was uninhabited by
// #sec-narrowto's own reasoning - "Two distinct ~primitive~ types have no common
// values" - had no default value, and admitted no value, and yet was NOT `never`
// and not even assignable to it, so the relation could not equate two empty
// types. The design document said such a type was a TypeError and the
// specification said, in one aside, that constructing one failed "exactly as the
// equivalent declaration fails"; neither was true of anything.
//
// The rule has two halves, and they are deliberately different:
//
//   - CANONICALIZATION reduces a disjoint intersection to `never`, so there is
//     ONE empty type. This must be total, because the kit computes with it:
//     `exclude(T, T)` and `union([])` are `never`, and a builder that threw
//     instead would make every kit function guard.
//   - The written syntax is an EARLY ERROR, so a program that wrote `&` for `|`
//     hears about it at the annotation rather than as "not assignable to never"
//     at every use site. This is the call #sec-narrowto already makes with its
//     ~empty~ sentinel for `d ?? 5`.

const kind = (decl: string): string => evaluated(
  `const d = (T) => String(Reflect.getReflection(T).kind); ${decl} d(U);`,
);

test('a written intersection with disjoint members is reported at the annotation', () => {
  expectThrown('type T = number & bigint;');
  expectThrown('type T = uint8 & string;');
  expectThrown('type T = uint8 & uint16;');
  expectThrown('type T = string & boolean;');
  expectThrown('type T = symbol & string;');
  expectThrown('type T = null & undefined;');
  expectThrown('type T = void & number;');
  expectThrown("type T = 'a' & 'b';");
  expectThrown('type T = true & false;');
  // The object/primitive pair, which #sec-narrowto also calls disjoint. This is
  // the one case TypeScript must keep inhabited, `string & { __brand }` being
  // its branding idiom; this proposal spells a brand `string.<{ brand: 'V' }>`
  // and so is free to reduce it.
  expectThrown('type T = uint8 & { a: uint8 };');
  expectThrown('type T = uint8 & [].<uint8>;');
  // Not only at a type alias.
  expectThrown('let x: number & bigint = 1;');
  expectThrown('function f(p: number & bigint) { return 1; }');
  // A disjoint pair anywhere among three or more members.
  expectThrown('type T = { a: uint8 } & number & bigint;');
});

test('an intersection whose members can share a value is untouched', () => {
  expect(kind('type U = { a: uint8 } & { b: string };')).toBe('intersection');
  expect(evaluated('interface A { a: uint8 } interface B { b: string } type C = A & B;'
    + ' let v: C = { a: 1, b: "s" }; String(v.b);')).toBe('s');
  // A keyless OBJECT member is not disjoint from a keyed one.
  expect(kind('type U = { a: uint8 } & { };')).toBe('object');
  // Two function types may share a value, so they still intersect.
  expect(kind("type U = (() => 'foo') & ((i: 42) => true);")).toBe('intersection');
});

test('BRAND LAYERING survives: disjointness is decided on the BASE', () => {
  // The case a rule phrased over "value types" would have destroyed. Two
  // parameterizations of ONE primitive share values - that is what makes a
  // layered brand a type rather than an empty one - and `ConvertValue` already
  // carried the same rule by hand as "an intersection whose members are ALL
  // parameterizations of ONE base".
  const EV = "type E = string.<{ brand: 'E' }>; type V = string.<{ pattern: /@/ }>; ";
  expect(kind(`${EV} type U = E & V;`)).toBe('intersection');
  expect(evaluated(`${EV}String((type E & V) === (type V & E));`)).toBe('true');
  // Two brands over one base are still one base, so still not disjoint.
  expect(kind("type A = uint32.<{ brand: 'A' }>; type B = uint32.<{ brand: 'B' }>; type U = A & B;")).toBe('intersection');
  // But a brand over one primitive IS disjoint from a different primitive,
  // because the base is what decides.
  expectThrown(`${EV}type U = E & uint8;`);
});

test('the walk to the base is a LOOP, so NESTED brands are not emptied', () => {
  // Parameterizing an already-parameterized type nests: the outer [[Base]] is
  // the inner TYPE, not the root. A single step would compare one ~parameterized~
  // record against another, fail to relate them, and - read as disjoint - empty
  // every layered type in the language.
  const N = "type E = string.<{ brand: 'E' }>; type N = E.<{ brand: 'N' }>;";
  expect(kind(`${N} type U = N & string;`)).toBe('parameterized');
  expect(kind(`${N} type U = N & E;`)).toBe('intersection');
  expect(kind(`${N} type M = E.<{ brand: 'M' }>; type U = N & M;`)).toBe('intersection');
  // Three layers still reach the root.
  const D = "type A = string.<{ brand: 'A' }>; type B = A.<{ brand: 'B' }>; type C = B.<{ brand: 'C' }>;";
  expect(kind(`${D} type U = C & string;`)).toBe('parameterized');
  // And a nested brand over one root is still disjoint from another root,
  // diagnosed at the annotation like any other.
  expectThrown(`${N} type U = N & uint8;`);
});

test('an OBJECT or ARRAY base carries a brand, so those layer too', () => {
  // A brand on an object base was refused when this rule was written and is now
  // a mark on the value. Disjointness reads the base, so two brands over one
  // object shape intersect exactly as two over a `string` do - and a rule that
  // had assumed every parameterized base was a primitive would have emptied them.
  const O = "type Base = { a: uint8 }; type A = Base.<{ brand: 'A' }>; type B = Base.<{ brand: 'B' }>;";
  expect(kind(`${O} type U = A & B;`)).toBe('intersection');
  expect(kind(`${O} type U = A & Base;`)).toBe('parameterized');
  expect(kind(`${O} type U = A & { b: string };`)).toBe('intersection');
  const A2 = "type Base = [].<uint8>; type A = Base.<{ brand: 'A' }>; type B = Base.<{ brand: 'B' }>;";
  expect(kind(`${A2} type U = A & B;`)).toBe('intersection');
  // An object-based brand is still disjoint from a primitive, for the ordinary
  // reason rather than because it is branded.
  expectThrown(`${O} type U = A & uint8;`);
});

test('a LITERAL base is decided by the primitive under it', () => {
  expect(kind("type L = 'a'; type A = string.<{ brand: 'A' }>; type B = L.<{ brand: 'B' }>; type U = A & B;")).toBe('intersection');
  expectThrown("type L1 = 'a'; type L2 = 'b'; type A = L1.<{ brand: 'A' }>;"
    + " type B = L2.<{ brand: 'B' }>; type U = A & B;");
});


test('an ARRAY or TUPLE is not disjoint from an OBJECT type', () => {
  // An array is a subtype of `Iterable.<T>`, which is an ~object~ type, so the
  // primitive/object rule must not be widened to array/object.
  //
  // The assertion is that neither is EMPTY, not that either stays an
  // intersection: an array is assignable to `Iterable.<T>`, so subsumption folds
  // that one to the array, which is absorption doing its job and not
  // annihilation. `{ length: uint32 }` has no such relation to an array and so
  // stays an intersection, which is the sharper probe of the two.
  expect(evaluated('type U = [].<uint8> & Iterable.<uint8>; String(U === never);')).toBe('false');
  expect(kind('type U = [].<uint8> & Iterable.<uint8>;')).toBe('array');
  expect(kind('type U = [].<uint8> & { length: uint32 };')).toBe('intersection');
});

test('the numeric value types are disjoint from `number`, as they already were', () => {
  // `uint8 & number` was a live intersection that nothing could inhabit:
  // `isAssignable` is false both ways and `5 instanceof uint8` is false, because
  // a numeric value type has its own values. Reducing states what was already so.
  expectThrown('type U = uint8 & number;');
  expectThrown('type U = float64 & number;');
  expectThrown('type U = uint8 & uint16;');
  expect(evaluated('String(Reflect.isAssignable(type uint8, type number));')).toBe('false');
});

test('subsumption still folds a member into a narrower one rather than reducing', () => {
  // A literal and its base SHARE values, so this is absorption and not
  // annihilation. Guards the rule against being written as "any two members of
  // different kinds are disjoint".
  expect(kind('type U = "a" & string;')).toBe('literal');
  expect(kind('type U = string & "a";')).toBe('literal');
  expect(kind('type U = 1 & number;')).toBe('literal');
  expect(kind('type U = true & boolean;')).toBe('literal');
});

test('canonicalization reduces to the ONE empty type', () => {
  const T = "Reflect.makeType({ kind: 'intersection', members: [type number, type bigint] })";
  expect(evaluated(`String(${T} === never);`)).toBe('true');
  // Every empty intersection is the same Type Object, so the relation equates
  // them. Before, `isAssignable(number & bigint, never)` was *false*.
  expect(evaluated(`String(Reflect.isAssignable(${T}, never) && Reflect.isAssignable(never, ${T}));`)).toBe('true');
  // A union arm that reduces away is DROPPED by flattening, so a slot of this
  // type is monomorphic rather than a two-arm union an engine would have to tag.
  expect(evaluated("type NB = Reflect.makeType({ kind: 'intersection', members: [type number, type bigint] });"
    + ' String(1);')).toBe('1');
});

test('a builder reaching an empty intersection gets `never`, and does not throw', () => {
  // The half that must stay TOTAL. `union([])` and `exclude(T, T)` are `never`
  // by #sec-never-type, and an intersection the kit computes must answer the
  // same way rather than making every caller guard.
  expect(evaluated("String(Reflect.makeType({ kind: 'intersection', members: [type number, type bigint] }) === never);")).toBe('true');
  expect(evaluated("String(Reflect.makeType({ kind: 'union', members: [] }) === never);")).toBe('true');
});

test('an explicitly written `never` member is exempt from the diagnostic', () => {
  // The annihilation identity of #sec-never-type, spelled out. The error exists
  // to catch an author who did not realise the intersection was empty; writing
  // `never` states that it is, so reporting it would make an identity a mistake
  // and stop generated code using `never` as a written annihilator.
  expect(evaluated('type N = never; type M = uint8 & never; String(N === M);')).toBe('true');
  expect(evaluated('type M = { a: uint8 } & never; String(M === never);')).toBe('true');
});

test('a generic body is not diagnosed for an instantiation that may not happen', () => {
  // AreDisjoint is conservative over an unresolved parameter, so the DECLARATION
  // stands and only a use that actually pairs disjoint types is reported.
  expect(evaluated('type F<T> = T & string; String(1);')).toBe('1');
});

test('an alias for an empty intersection reports once, at its own declaration', () => {
  // The error is on the node, so a use of the alias does not report it again.
  // Guards against a cascade in which one mistake produces an error per mention.
  const c = evaluated('try { eval("type Z = number & bigint; type W = uint8 & Z;"); "no" } catch (e) { "one" }');
  expect(c).toBe('one');
});

test('the refusal for `never` names the reason, not an impossible remedy', () => {
  // `never` has no default because it has NO VALUES, so "a declaration of it
  // needs an initializer" named a remedy that cannot exist: there is no
  // expression of type `never` to write. The advice was wrong in exactly the
  // case the empty-intersection rule makes reachable, which is where a reader is
  // most likely to meet it.
  const message = (src: string): string => {
    const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
    return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
  };
  expect(message('let x: never;')).toContain('has no values');
  expect(message('let x: never;')).not.toContain('needs an initializer');
  // A type that merely lacks a default keeps the original advice, which is
  // followable.
  expect(message('let x: { f: never };')).toContain('needs an initializer');
  expect(message('let u: uint8 | string;')).toContain('needs an initializer');
});

test('an inline annotation names the type it DENOTES, not its members', () => {
  // An annotation resolved inline reaches the refusal as an un-interned record,
  // so an empty intersection was named by its members while the same type behind
  // an alias was named `never` - one type, two spellings, two messages. The
  // shared refusal canonicalizes before displaying.
  const message = (src: string): string => {
    const c = run(src) as { Type: string, Value?: { HostDefinedMessageString?: string } };
    return c.Type === 'throw' ? String(c.Value?.HostDefinedMessageString) : `NO THROW: ${src}`;
  };
  const N = "type E = string.<{ brand: 'E' }>; type N = E.<{ brand: 'N' }>;";
  expect(message(`${N} let x: N & uint8;`)).toContain('never');
  expect(message(`${N} let x: N & uint8;`)).not.toContain('&');
  // The alias spelling of the same type already said this, and still does.
  expect(message(`${N} type V = N & uint8; let x: V;`)).toContain('never');
});
