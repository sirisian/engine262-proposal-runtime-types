import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * `PLAN-checker-type-resolution.md stage A`: the checker resolves the type names
 * the runtime resolves.
 *
 * The checker resolves an annotation with `resolveType`, a second resolver
 * mirroring `TypeNodeToTypeRecord`. A name only the runtime knew resolved to
 * NOTHING there, and a null type is treated as no constraint - so an annotation
 * naming one was never compared, silently. `Token`, the 27 metadata interfaces
 * and all 47 `Reflect.*` names were in that state: 75 names the runtime enforced
 * and the checker could not read.
 *
 * The probe throughout is a RETURN-TYPE MISMATCH between two function types.
 * Nothing else distinguishes the states: a runtime check still refuses a bad
 * value for an unresolvable annotation, because a function is a function at run
 * time whatever its signature says. Only a function-to-function comparison,
 * which is static and nothing else, shows whether the checker read the name.
 */
const mismatch = (ty: string) => `function f(x: ${ty}): string { return "s"; } const a: (x: ${ty}) => number = f;`;

test('a bare intrinsic type name is resolved', () => {
  // `Token` is the name the JSX macro in ecmascript-types/examples/jsx.md
  // returns, and the one that made the gap visible.
  expectStaticTypeError(mismatch('Token'));
  expectStaticTypeError(mismatch('ClassMetadata'));
  expectStaticTypeError(mismatch('EnumEnumeratorMetadata'));
  // Already resolvable before stage A, so a guard against fixing one by breaking
  // the other: `TokenStream` is in `libraryTypeNames` and `Token` never was.
  expectStaticTypeError(mismatch('TokenStream'));
  expectStaticTypeError(mismatch('string'));
});

test('a QUALIFIED type name is resolved', () => {
  // The whole `Reflect.*` namespace answered null unconditionally.
  expectStaticTypeError(mismatch('Reflect.Region'));
  expectStaticTypeError(mismatch('Reflect.Class'));
  expectStaticTypeError(mismatch('Reflect.ClassFieldLayout'));
  // Not a context, and so left behind by a registration that kept only contexts.
  expectStaticTypeError(mismatch('Reflect.never'));
});

test('one unresolvable parameter no longer defeats a whole signature', () => {
  // An annotation is resolved as a WHOLE: one unresolvable name in it made the
  // entire target type unresolvable, and the comparison then did not happen at
  // all - `IsFunctionSubtype` was never reached. So a single `Reflect.Region`
  // parameter stopped the RETURN from being compared too.
  expectStaticTypeError(
    'function f(x: number, c: Reflect.Region): string { return "s"; }'
    + ' const a: (x: number, c: Reflect.Region) => number = f;',
  );
});

test('a resolved name does not displace a declaration that completes it', () => {
  // `partial interface` extends exactly these intrinsic names, so this lookup
  // sits LAST among the name lookups. Ahead of `interfaceTypeOf` the empty
  // intrinsic record shadowed the completed one and the added member stopped
  // being checked - silently, which is the failure mode this whole plan is about.
  expect(evaluated('partial interface ClassMetadata { b: string; } let v: ClassMetadata = { b: "x" }; "took";')).toBe('took');
  expectThrown('partial interface ClassMetadata { b: string; } let w: ClassMetadata = {};');
  // And with no partial, the intrinsic declares nothing, so any object is admitted.
  expect(evaluated('let m: ClassMetadata = {}; "admitted";')).toBe('admitted');
  // The SHAPE judgment stays at evaluation, deliberately: an intrinsic's shape is
  // completed by whichever partials have evaluated, so judging it from the source
  // text would accept an object a later partial makes insufficient. Only the KIND
  // moved to the checker, and no partial can make `5` an object.
  expectStaticTypeError('let m: ClassMetadata = 5;');
});
