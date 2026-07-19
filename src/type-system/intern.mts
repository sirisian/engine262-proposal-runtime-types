import type { ObjectValue } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { neverType, orderKey } from './records.mts';
import { SameType } from './relations.mts';
import { OrdinaryObjectCreate, surroundingAgent } from '#self';

/**
 * proposal-runtime-types #sec-canonicalizetype and #sec-gettypeobject
 */
export type TypeObject = ObjectValue & { TypeRecord: TypeRecord };

export function isTypeObject(value: unknown): value is TypeObject {
  return !!value && typeof value === 'object' && 'TypeRecord' in (value as object);
}

/** #sec-canonicalizetype */
export function CanonicalizeType(t: TypeRecord): TypeRecord {
  if (t.Kind === 'union' || t.Kind === 'intersection') {
    let members: TypeRecord[] = [];
    for (const m of t.Members) {
      const c = CanonicalizeType(m);
      if (c.Kind === t.Kind) {
        members.push(...(c as { Members: readonly TypeRecord[] }).Members);
      } else {
        members.push(c);
      }
    }
    members = members.filter((m, i) => !members.slice(0, i).some((earlier) => SameType(earlier, m)));
    if (t.Kind === 'intersection' && members.some((m) => m.Kind === 'union' && m.Members.length === 0)) {
      return neverType;
    }
    if (members.length === 1) {
      return members[0];
    }
    members.sort((a, b) => (orderKey(a) < orderKey(b) ? -1 : 1));
    return { Kind: t.Kind, Members: members };
  }
  if (t.Kind === 'tuple') {
    return { Kind: 'tuple', Elements: t.Elements.map((e) => ({ Type: CanonicalizeType(e.Type), Rest: e.Rest, Initial: e.Initial })) };
  }
  if (t.Kind === 'array') {
    return { Kind: 'array', Element: CanonicalizeType(t.Element), Extent: t.Extent };
  }
  if (t.Kind === 'reference') {
    return { Kind: 'reference', Target: CanonicalizeType(t.Target) };
  }
  if (t.Kind === 'literal') {
    return { Kind: 'literal', Value: t.Value, Base: CanonicalizeType(t.Base) };
  }
  if (t.Kind === 'parameterized') {
    return { Kind: 'parameterized', Base: CanonicalizeType(t.Base), Metadata: t.Metadata };
  }
  if (t.Kind === 'primitive') {
    return { Kind: 'primitive', Name: t.Name, Arguments: t.Arguments.map((a) => (typeof a === 'number' ? a : CanonicalizeType(a))) };
  }
  // proposal-runtime-types: an object's property and index-signature types are
  // themselves canonicalized, so a union or intersection nested in a property is
  // sorted and deduplicated the same way a standalone one is. Without this, a
  // property union built by makeType and the same union written in source could
  // carry their members in different orders and, because SameType compares union
  // members position-wise over the canonical form, intern as distinct types.
  if (t.Kind === 'object') {
    return {
      Kind: 'object',
      Properties: t.Properties.map((p) => ({ key: p.key, type: CanonicalizeType(p.type), optional: p.optional, readonly: p.readonly })),
      IndexSignatures: t.IndexSignatures.map((ix) => ({ Key: CanonicalizeType(ix.Key), Value: CanonicalizeType(ix.Value) })),
    };
  }
  // A function's parameter, return, and this types are canonicalized for the same
  // reason. [[ThisType]] is preserved as ~none~ (null) where absent.
  if (t.Kind === 'function') {
    return {
      Kind: 'function',
      Signatures: t.Signatures.map((g) => ({
        Parameters: g.Parameters.map(CanonicalizeType),
        Return: g.Return === null ? null : CanonicalizeType(g.Return),
        ThisType: g.ThisType === undefined || g.ThisType === null ? g.ThisType : CanonicalizeType(g.ThisType),
      })),
    };
  }
  return t;
}

// The intern table is a property of a heap; engine262's Agent plays that
// part, so the table is keyed by the surrounding agent.
const internTables = new WeakMap<object, TypeObject[]>();

/** #sec-gettypeobject */
export function GetTypeObject(t: TypeRecord, realm?: { readonly Intrinsics: { readonly '%Type.prototype%': ObjectValue } }): TypeObject {
  const canonical = CanonicalizeType(t);
  const agent = surroundingAgent as unknown as object;
  let table = internTables.get(agent);
  if (!table) {
    table = [];
    internTables.set(agent, table);
  }
  for (const existing of table) {
    if (SameType(existing.TypeRecord, canonical)) {
      return existing;
    }
  }
  const proto = (realm ?? surroundingAgent.currentRealmRecord).Intrinsics['%Type.prototype%'];
  const obj = OrdinaryObjectCreate(proto, ['TypeRecord']) as unknown as TypeObject;
  obj.TypeRecord = canonical;
  table.push(obj);
  return obj;
}
