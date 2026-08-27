import { ObjectInspector } from './objects.mts';
import {
  canonicalTypeText, type TypeObject, GetTypeObject, CreateArrayFromList, Value,
} from '#self';

/**
 * A Type Object in the console.
 *
 * PLAN-devtools-type-inspection.md F193. Without this a type rendered as a
 * native function: the dispatch ladder in `./index.mts` tests `IsCallable`
 * before any later case, and a Type Object IS callable - that is its
 * construction boundary, `Email('a@b')` - so it matched there and got the
 * `Function` inspector.
 *
 * Nothing was broken; a case was missing, and the ladder already carried two
 * proposal-specific entries above the callable one.
 *
 * The collapsed description is the canonical source form (F194), so what the
 * console shows is text the developer can paste back, and it is the same
 * function `String(T)` calls - the two cannot disagree.
 */
export const Type = new ObjectInspector<TypeObject>(
  'Type',
  undefined,
  (value) => canonicalTypeText(value.TypeRecord),
  {
    /**
     * Expansion. Every field that holds a type yields a TYPE OBJECT, so opening
     * it renders through this same inspector and opens again - the developer
     * walks the whole structure without calling `Reflect.getReflection` at each
     * step.
     *
     * A recursive type needs no special case: `type Node = { next: Node | null }`
     * reaches `Node` again and shows another collapsed `Type`, which the
     * developer may open or not. Expansion is on demand, so laziness is the
     * termination condition - the same reason the object inspector handles a
     * cyclic plain object without a cycle marker.
     */
    additionalProperties: (value) => {
      const t = value.TypeRecord as unknown as Record<string, unknown> & { Kind: string };
      const out: [string, Value][] = [['kind', Value(t.Kind)]];
      const asType = (r: unknown) => GetTypeObject(r as never) as unknown as Value;
      const listOf = (rs: readonly unknown[]) => CreateArrayFromList(rs.map(asType)) as unknown as Value;
      switch (t.Kind) {
        case 'union':
        case 'intersection':
          out.push(['members', listOf(t.Members as readonly unknown[])]);
          break;
        case 'object':
          // An object property's type field is LOWERCASE `type`, where a
          // tuple element's is `Type`. The two record shapes disagree about
          // casing; reading the wrong one yields undefined rather than an
          // error, so it is worth naming here.
          out.push(['properties', listOf(
            (t.Properties as readonly { type: unknown }[]).map((p) => p.type),
          )]);
          break;
        case 'array':
          out.push(['element', asType(t.Element)]);
          break;
        case 'tuple':
          out.push(['elements', listOf(
            (t.Elements as readonly { Type: unknown }[]).map((e) => e.Type),
          )]);
          break;
        case 'parameterized':
        case 'literal':
          out.push(['base', asType(t.Base)]);
          break;
        default:
          break;
      }
      return out;
    },
  },
);
