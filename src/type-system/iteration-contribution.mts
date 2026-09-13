import { wellKnownSymbols, Value } from '#self';
import { CanonicalizeType } from './intern.mts';
import type { TypeRecord } from './records.mts';

export interface IterationContribution {
  readonly element: TypeRecord | null;
  readonly positions?: readonly TypeRecord[];
}

const unknownContribution: IterationContribution = { element: null };
const join = (types: readonly TypeRecord[]): TypeRecord | null => types.length === 0 ? null
  : types.length === 1 ? types[0]! : CanonicalizeType({ Kind: 'union', Members: types });

/** #sec-static-iteration-contribution: infer from the iteration protocol, not indexed storage. */
export function StaticIterationContribution(
  type: TypeRecord | null,
  structureOf: (type: TypeRecord | null) => TypeRecord | null,
): IterationContribution {
  if (!type) return unknownContribution;
  if (type.Kind === 'primitive' && type.Name === 'Composite') {
    const shape = type.Arguments[0];
    if (typeof shape === 'object' && shape?.Kind === 'tuple') {
      const positions = shape.Elements.map((position) => position.Type);
      if (shape.Elements.every((position) => !position.Rest && !position.DeclaredDefault)) {
        return { element: join(positions), positions };
      }
    }
    return unknownContribution;
  }
  // Arrays and tuples permit iterator replacement independently of storage.
  if (type.Kind === 'array' || type.Kind === 'tuple') return unknownContribution;
  const shape = structureOf(type);
  if (shape?.Kind !== 'object') return unknownContribution;
  const method = shape.Properties.find((property) => property.key === wellKnownSymbols.iterator)?.type;
  if (method?.Kind !== 'function' || method.Signatures.length !== 1) return unknownContribution;
  const iterator = method.Signatures[0]!.Return;
  if (iterator?.Kind === 'nominal' && iterator.LibraryName === 'Generator') {
    const yielded = iterator.Arguments[0];
    return { element: typeof yielded === 'object' ? yielded : null };
  }
  const iteratorShape = structureOf(iterator ?? null);
  const next = iteratorShape?.Kind === 'object' ? iteratorShape.Properties.find((property) => property.key === 'next')?.type : null;
  if (next?.Kind !== 'function' || next.Signatures.length !== 1) return unknownContribution;
  const result = next.Signatures[0]!.Return;
  if (!result) return unknownContribution;
  const types: TypeRecord[] = [];
  for (const variant of result.Kind === 'union' ? result.Members : [result]) {
    const record = structureOf(variant);
    if (record?.Kind !== 'object') return unknownContribution;
    const done = record.Properties.find((property) => property.key === 'done')?.type;
    if (done?.Kind === 'literal' && done.Value === Value.true) continue;
    const value = record.Properties.find((property) => property.key === 'value')?.type;
    if (!value) return unknownContribution;
    types.push(value);
  }
  return { element: join(types) };
}
