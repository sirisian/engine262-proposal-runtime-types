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

/** #sec-static-iteration-contribution: for-await awaits steps, not async values. */
export function AsyncIterationContribution(
  type: TypeRecord | null,
  structureOf: (type: TypeRecord | null) => TypeRecord | null,
  awaitedType: (type: TypeRecord | null) => TypeRecord | null,
  syncElement: (type: TypeRecord) => TypeRecord | null,
): IterationContribution {
  const combine = (parts: readonly IterationContribution[]): IterationContribution => ({
    element: parts.every((part) => part.element !== null) ? join(parts.map((part) => part.element!)) : null,
  });
  if (!type) return unknownContribution;
  if (type.Kind === 'union') return combine(type.Members.map((arm) => AsyncIterationContribution(arm, structureOf, awaitedType, syncElement)));
  if (type.Kind === 'nominal' && type.LibraryName === 'AsyncGenerator') {
    const yielded = type.Arguments[0];
    return { element: typeof yielded === 'object' ? awaitedType(yielded) : null };
  }
  const shape = structureOf(type);
  const hook = shape?.Kind === 'object' ? shape.Properties.find((property) => property.key === wellKnownSymbols.asyncIterator) : undefined;
  const fallback = (): IterationContribution => ({ element: awaitedType(syncElement(type)) });
  if (!hook) return fallback();
  const stepValue = (result: TypeRecord | null): IterationContribution => {
    if (!result) return unknownContribution;
    if (result.Kind === 'union') return combine(result.Members.map(stepValue));
    const record = structureOf(result);
    if (record?.Kind !== 'object') return unknownContribution;
    const done = record.Properties.find((property) => property.key === 'done');
    if (!done?.optional && done?.type.Kind === 'literal' && done.type.Value === Value.true) {
      return { element: { Kind: 'union', Members: [] } };
    }
    const value = record.Properties.find((property) => property.key === 'value');
    return value && !value.optional ? { element: value.type } : unknownContribution;
  };
  const next = (iterator: TypeRecord | null): IterationContribution => {
    if (!iterator) return unknownContribution;
    if (iterator.Kind === 'union') return combine(iterator.Members.map(next));
    const record = structureOf(iterator);
    const method = record?.Kind === 'object' ? record.Properties.find((property) => property.key === 'next') : undefined;
    const fn = method?.type;
    return !method?.optional && fn?.Kind === 'function' && fn.Signatures.length === 1
      ? stepValue(awaitedType(fn.Signatures[0]!.Return)) : unknownContribution;
  };
  const select = (method: TypeRecord): IterationContribution => {
    if (method.Kind === 'union') return combine(method.Members.map(select));
    if (method.Kind === 'primitive' && ['null', 'undefined'].includes(method.Name)) return fallback();
    return method.Kind === 'function' && method.Signatures.length === 1
      ? next(method.Signatures[0]!.Return) : unknownContribution;
  };
  const selected = select(hook.type);
  return hook.optional ? combine([selected, fallback()]) : selected;
}
