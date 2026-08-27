import { ObjectInspector } from './objects.mts';
import { canonicalTypeText, type TypeObject } from '#self';

/**
 * A Type Object in the console.
 *
 * PLAN-devtools-type-inspection.md F193. Without this a type rendered as
 * `ƒ () { [native code] }`: the dispatch ladder in `./index.mts` tests
 * `IsCallable` before any later case, and a Type Object IS callable — that is
 * its construction boundary, `Email('a@b')` — so it matched there and got the
 * `Function` inspector, whose description for a built-in is
 * `function() { [native code] }`.
 *
 * Nothing was broken; a case was missing, and the ladder already carried two
 * proposal-specific entries above the callable one.
 *
 * The description is the canonical source form (F194), so what the console shows
 * collapsed is text the developer can paste back, and it is the same function
 * `String(T)` calls — the two cannot disagree.
 */
export const Type = new ObjectInspector<TypeObject>(
  'Type',
  undefined,
  (value) => canonicalTypeText(value.TypeRecord),
);
