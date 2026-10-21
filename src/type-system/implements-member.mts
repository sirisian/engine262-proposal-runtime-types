import type { TypeRecord } from './records.mts';
import { anyType } from './records.mts';
import { IsAssignable } from './relations.mts';

type Property = Omit<Extract<TypeRecord, { Kind: 'object' }>['Properties'][number], 'readonly'> & { readonly?: boolean };
const shape = (property: Property): TypeRecord => ({
  Kind: 'object', Properties: [{ ...property, readonly: !!property.readonly }], IndexSignatures: [],
});
const method = (type: TypeRecord): boolean => type.Kind === 'function'
  && type.Signatures.every((signature) => signature.ThisType?.Kind === 'nominal'
    && (signature.ThisType.Declaration as { type: string }).type === 'SelfThisMarker');

/** Method implementation uses the signature relation; storage keeps invariance. */
export function DeclaredMemberImplements(actual: Property, wanted: Property): boolean {
  if (method(actual.type) && method(wanted.type)) {
    return IsAssignable(shape({ ...actual, type: anyType }), shape({ ...wanted, type: anyType }))
      && IsAssignable(actual.type, wanted.type);
  }
  return IsAssignable(shape(actual), shape(wanted));
}
