import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-accessor.md stage 0. `accessor` has no grammar under `runtime-types`,
 * so nothing here can assert that a declaration reaches `Reflect.ClassAccessor`
 * yet. What it can do is fix the state stage A will start from and PIN it, so
 * that stage A's first failure is its own and not one left underneath it.
 *
 * What stage 0 removed: two branches of `memberContextKind` that could never
 * run, both hidden by an `as unknown as { ... }` cast that INVENTED a shape
 * rather than narrowing a real one, so no field name in it was ever checked.
 *
 *   - `ClassOperator` was decided on an `OperatorName`, which lives only on an
 *     OperatorDefinition - and an OperatorDefinition never reaches
 *     ClassElementEvaluation, because the class body walk intercepts it.
 *   - `ClassAccessor` was decided on an `Accessor` field NO PARSER SETS (the
 *     spelling is `accessor`), and could not have run even spelled correctly,
 *     because `accessor` produces a FIELD DEFINITION while that function is
 *     reached only from the method arm.
 *
 * The function is now typed to the four method forms that actually call it, so
 * a field it reads has to exist on one of them - which is the part that stops
 * this recurring. Removing unreachable code changes no behaviour, and the
 * assertions below are what say so.
 */

test('the contexts that DO come from the member dispatch still do', () => {
  // The three branches left standing, one assertion each. If narrowing the
  // parameter type had changed which branch a member takes, these move.
  const k = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${k} class A { @f m() {} } k;`)).toBe('ClassMethod');
  expect(evaluated(`${k} class A { @f get x() { return 1; } } k;`)).toBe('ClassGetter');
  expect(evaluated(`${k} class A { @f set x(v: uint8) {} } k;`)).toBe('ClassSetter');
  // A field takes the FieldDefinition arm and never consults the member
  // dispatch at all - which is exactly why the accessor decision has to live
  // there when the grammar lands, and not where it used to be written.
  expect(evaluated(`${k} class A { @f a: uint8 = 1; } k;`)).toBe('ClassField');
});

test('an operator still takes its contexts from the class-body interception', () => {
  // The deleted `OperatorName` branch was not load-bearing: an operator's
  // sub-target contexts are named at the interception that registers the
  // operator (C1), which is why removing it changes nothing here.
  const k = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${k} class O { operator +(@f r: O): O { return r; } } k;`)).toBe('ClassOperatorParameter');
  expect(evaluated(`${k} class O { operator +(r: O): @f O { return r; } } k;`)).toBe('ClassOperatorReturn');
});

test('PINNED FOR STAGE A: `accessor` has no grammar yet', () => {
  // The pin stage A flips. All four forms, because the grammar has to admit all
  // four and a stage that opened only the plain one would pass a single check.
  const refused = (source: string) => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(refused('class A { accessor a: uint32 = 5; }')).toBe('SyntaxError');
  expect(refused('class A { static accessor count: uint32 = 0; }')).toBe('SyntaxError');
  expect(refused('class A { accessor #internal: int32 = 0; }')).toBe('SyntaxError');
  expect(refused('class A { accessor a = 5; }')).toBe('SyntaxError');
  // And the context it will reach exists already, so stage A opens a grammar
  // onto something built rather than onto nothing.
  expect(evaluated('typeof Reflect.ClassAccessor;')).toBe('object');
  expect(evaluated('typeof ClassAccessorMetadata;')).toBe('object');
});

test('PINNED FOR STAGE A: `accessor` is an ordinary identifier and must stay one', () => {
  // The hazard stage A must not break. `accessor` is not a reserved word, and
  // TC39's parser handles it with a lookahead: the keyword reading needs a
  // property name on the SAME LINE after it, so `accessor` alone is a field
  // named `accessor` and `accessor \n x` is too. These pass today because the
  // keyword does not exist at all; after stage A they pass only if the
  // lookahead was copied correctly, which is the point of pinning them now.
  expect(evaluated('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
  expect(evaluated('class A { accessor: uint8 = 7; } String(new A().accessor);')).toBe('7');
  expect(evaluated('const accessor = 3; String(accessor);')).toBe('3');
  expect(evaluated('class A { accessor() { return "method"; } } (new A()).accessor();')).toBe('method');
});
