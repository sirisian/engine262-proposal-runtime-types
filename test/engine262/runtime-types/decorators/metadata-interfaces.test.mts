import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, expectThrownKind,
} from '../harness.mts';

/**
 * proposal-runtime-types #sec-decorator-metadata: the intrinsic metadata
 * interfaces, `%ClassMetadata%`, `%ClassFieldMetadata%`, and one per
 * metadata-carrying context.
 *
 * "A program adds to one by declaring a `partial interface` over it whose
 * members are typed and Symbol-keyed, and the members it adds are the only
 * ones there are: THE INTRINSIC INTERFACES DECLARE NONE."
 *
 * The set is decorators.md's, read off the reflection structures: a context
 * has a metadata interface exactly where its reflection carries a `metadata`
 * member - the Class family (twelve), the Function family (three), the Object
 * family (nine), and the Enum family (two). The design says of the rest, in as
 * many words: "No `getMetadata` overloads exist for `Reflect.Let`,
 * `Reflect.Const`, `Reflect.Tuple`, `Reflect.Record`, or block contexts, as
 * their reflection structures do not carry metadata." `Reflect.Type`'s
 * reflection carries none either.
 */

const names = [
  // The Class family.
  'ClassMetadata', 'ClassFieldMetadata', 'ClassAccessorMetadata',
  'ClassGetterMetadata', 'ClassGetterReturnMetadata', 'ClassSetterMetadata',
  'ClassSetterParameterMetadata', 'ClassMethodMetadata',
  'ClassMethodParameterMetadata', 'ClassMethodReturnMetadata',
  'ClassOperatorMetadata', 'ClassOperatorParameterMetadata',
  // The Function family.
  'FunctionMetadata', 'FunctionParameterMetadata', 'FunctionReturnMetadata',
  // The Object family.
  'ObjectMetadata', 'ObjectFieldMetadata', 'ObjectGetterMetadata',
  'ObjectGetterReturnMetadata', 'ObjectSetterMetadata',
  'ObjectSetterParameterMetadata', 'ObjectMethodMetadata',
  'ObjectMethodParameterMetadata', 'ObjectMethodReturnMetadata',
  // The Enum family.
  'EnumMetadata', 'EnumEnumeratorMetadata',
];

test('all twenty-six metadata interfaces resolve, and to twenty-six types', () => {
  // Every name resolves to a Type Object. The joined report reads as the list,
  // so a missing name fails by NAMING itself rather than by a count.
  const report = names.map((n) => `(typeof ${n})`).join(' + "," + ');
  expect(evaluated(`${report};`)).toBe(names.map(() => 'object').join(','));
  // And they are twenty-six DISTINCT types. Resolution alone passes with all
  // names bound to one interned object, which is the interning mistake this
  // asserts against.
  expect(evaluated(`String(new Set([${names.join(', ')}]).size);`)).toBe('26');
});

test('an intrinsic metadata interface declares nothing', () => {
  // An interface declaring no members admits any object: before a partial has
  // contributed, there is nothing for a value to lack.
  expect(evaluated('let m: ClassMetadata = {}; "admitted";')).toBe('admitted');
  // And it is still an OBJECT type. A value of the wrong kind is a TypeError
  // (F12's split: wrong kind is Type, out of range is Range).
  expectThrownKind('let m: ClassMetadata = 5;', 'TypeError');
});

test('a partial interface completes an intrinsic, and the members are required', () => {
  // THE ASSERTION THAT MATTERS is the negative, cycle 126's lesson at the
  // intrinsics: `{ b: "x" }` passes whether or not the merge took, so the
  // proof the intrinsic took the same merge path a user interface does is
  // that an object WITHOUT the member is now refused.
  expect(evaluated('partial interface ClassMetadata { b: string; } let v: ClassMetadata = { b: "x" }; "took";')).toBe('took');
  expectThrown('partial interface ClassMetadata { b: string; } let w: ClassMetadata = {};');
  // A member already contributed is a conflict rather than an override, on the
  // intrinsics exactly as on a user interface: the meaning of `%ClassMetadata%`
  // must not depend on load order.
  expectThrown('partial interface ClassMetadata { b: string; } partial interface ClassMetadata { b: uint8; }');
});

test('a partial over one intrinsic leaves its siblings untouched', () => {
  // Twenty-six names, twenty-six types: contributing to `%ClassMetadata%` adds
  // nothing to `%ClassFieldMetadata%`. A shared structure between the records
  // would pass every test above and fail this one.
  expect(evaluated('partial interface ClassMetadata { b: string; } let v: ClassFieldMetadata = {}; "untouched";')).toBe('untouched');
});

test('the contexts whose reflections carry no metadata have no interface', () => {
  // decorators.md: Let, Const, Tuple, Record, and the block contexts "do not
  // carry metadata", and Reflect.Type's reflection has no `metadata` member.
  // The names must therefore NOT exist - an interface here would be surface
  // no document declares.
  const absent = ['TypeMetadata', 'LetMetadata', 'ConstMetadata', 'BlockMetadata', 'TupleMetadata', 'RecordMetadata'];
  const report = absent.map((n) => `(typeof ${n})`).join(' + "," + ');
  expect(evaluated(`${report};`)).toBe(absent.map(() => 'undefined').join(','));
});

test('the names bind as the primitive type names do', () => {
  // #sec-value-types: "the type names are global bindings of their interned
  // Type Objects" - non-writable, so an assignment does not rebind.
  expect(evaluated('ClassMetadata = 5; typeof ClassMetadata;')).toBe('object');
});

test('PINNED GAPS for stage H, the metadata half', () => {
  // 1. HALF CLOSED (cycle 148). The interface member walk now EVALUATES a
  // computed key instead of dropping it, so a Symbol-keyed member is a REAL
  // member: its presence is required, and a second declaration of it is the
  // conflict a string-keyed one is. symbol-metadata-keys.test.mts owns those.
  //
  // CLOSED (cycle 152): the checker judges a symbol-keyed member too, by the
  // minted key of the `const` its computed name resolves to. What bounds BOTH
  // key kinds is the checker's reach - a wrong store it cannot see is accepted
  // with a string key as much as a symbol one. See symbol-literal-keys.test.mts
  // and symbol-metadata-keys.test.mts.
  const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  const decl = 'const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } ';
  expect(outcome(`${decl} let m: ClassFieldMetadata = { [k]: "ok" }; m[k] = 5;`)).toBe('TypeError');
  expect(outcome('partial interface ClassFieldMetadata { s: string; } let m: ClassFieldMetadata = { s: "ok" }; m.s = 5;')).toBe('TypeError');
  // 2. The static checker does not know the intrinsic names: the same wrong
  // kind a user interface rejects in a never-called function (F37's
  // convention) passes here, and only the runtime boundary refuses. That is
  // DELIBERATE for now rather than an oversight: the checker judges shapes it
  // reads from the source text, and an intrinsic's shape is completed by
  // whichever partials have EVALUATED - so a static judgment over the empty
  // declaration would accept an object a later partial makes insufficient.
  // Measured: a partial-touched USER interface is exactly as unknown to the
  // checker, so the intrinsics match the engine's existing behavior for
  // interfaces whose shape moves at evaluation.
  expect(evaluated('function f() { let m: ClassMetadata = 5; } "unjudged";')).toBe('unjudged');
  // The runtime backstop, asserted beside the static miss (F37).
  expectThrownKind('let m: ClassMetadata = 5;', 'TypeError');
});
