import { nativeEvalInAnyRealm } from '../evaluator.mts';
import { ObjectInspector } from './objects.mts';
import {
  canonicalTypeText, type TypeObject, GetTypeObject, CreateArrayFromList, Value,
  OrdinaryObjectCreate, Descriptor, surroundingAgent,
} from '#self';

/**
 * A Type Object in the console.
 *
 * Without this a type rendered as a
 * native function: the dispatch ladder in `./index.mts` tests `IsCallable`
 * before any later case, and a Type Object IS callable - that is its
 * construction boundary, `Email('a@b')` - so it matched there and got the
 * `Function` inspector.
 *
 * Nothing was broken; a case was missing, and the ladder already carried two
 * proposal-specific entries above the callable one.
 *
 * The collapsed description is the canonical source form, so what the
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
    additionalProperties: (value, context) => {
      const t = value.TypeRecord as unknown as Record<string, unknown> & { Kind: string };
      const out: [string, Value][] = [['kind', Value(t.Kind)]];
      // `GetTypeObject` reads `currentRealmRecord`, and an inspector runs
      // OUTSIDE any execution context - it threw "Cannot read properties of
      // undefined (reading 'Realm')" and hung the session. Every other renderer
      // that touches the realm goes through this wrapper.
      let entered = true;
      const asType = (r: unknown) => GetTypeObject(r as never) as unknown as Value;
      const listOf = (rs: readonly unknown[]) => CreateArrayFromList(rs.map(asType)) as unknown as Value;
      /**
       * A NAMED collection as an ordinary object - `{ a: <Type>, b: <Type> }`
       * for an object type's properties - so that opening `properties` shows
       * the names, which are most of what a developer drilling into
       * `{ a: uint32, b: float32 }` is there for. A list of the types alone
       * dropped them.
       */
      const recordOf = (pairs: readonly [string, Value][]) => {
        const o = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
        // Set directly, as the array builder in `objects.mts` does:
        // `CreateDataProperty` is a generator, and an inspector renderer is not
        // an evaluation to drive one in.
        for (const [k, v] of pairs) {
          o.properties.set(Value(k), Descriptor({
            Value: v, Writable: Value.false, Enumerable: Value.true, Configurable: Value.false,
          }));
        }
        return o as unknown as Value;
      };
      const reached = nativeEvalInAnyRealm(true, context, () => {
        switch (t.Kind) {
        case 'union':
        case 'intersection':
          out.push(['members', listOf(t.Members as readonly unknown[])]);
          break;
        case 'object': {
          // An object property's type field is LOWERCASE `type`, where a
          // tuple element's is `Type`. The two record shapes disagree about
          // casing; reading the wrong one yields undefined rather than an
          // error, so it is worth naming here.
          const props = t.Properties as readonly { key: string, type: unknown, optional?: boolean, readonly?: boolean }[];
          out.push(['properties', recordOf(props.map((p): [string, Value] => [
            `${p.readonly ? 'readonly ' : ''}${p.key}${p.optional ? '?' : ''}`, asType(p.type),
          ]))]);
          break;
        }
        case 'array':
          out.push(['element', asType(t.Element)]);
          if (t.Extent !== undefined && t.Extent !== 'dynamic') {
            out.push(['extent', Value(String(t.Extent))]);
          }
          break;
        case 'tuple':
          out.push(['elements', listOf(
            (t.Elements as readonly { Type: unknown }[]).map((e) => e.Type),
          )]);
          break;
        case 'parameterized':
          out.push(['base', asType(t.Base)]);
          break;
        case 'literal':
          out.push(['value', t.Value as Value]);
          out.push(['base', asType(t.Base)]);
          break;
        case 'function': {
          // Each signature as `{ parameters: { name: <Type> }, returns: <Type> }`.
          const sigs = t.Signatures as readonly { Parameters: readonly { Name?: string, Type: unknown, Optional?: boolean, Rest?: boolean }[], Return: unknown }[];
          out.push(['signatures', CreateArrayFromList(sigs.map((s) => recordOf([
            ['parameters', recordOf(s.Parameters.map((prm, i): [string, Value] => [
              `${prm.Rest ? '...' : ''}${prm.Name ?? `arg${i}`}${prm.Optional ? '?' : ''}`, asType(prm.Type),
            ]))],
            ['returns', s.Return ? asType(s.Return) : Value.undefined],
          ]))) as unknown as Value]);
          break;
        }
        case 'nominal': {
          const args = t.Arguments as readonly unknown[] | undefined;
          if (args && args.length > 0) {
            out.push(['arguments', CreateArrayFromList(args.map((a) => (typeof a === 'number' ? Value(a) : asType(a)))) as unknown as Value]);
          }
          break;
        }
        default:
          break;
        }
        return true;
      });
      if (reached === undefined) {
        entered = false;
      }
      if (!entered) {
        return [['kind', Value(t.Kind)]];
      }
      return out;
    },
  },
);
