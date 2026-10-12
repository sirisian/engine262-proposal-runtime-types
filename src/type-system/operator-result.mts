import type { TypeRecord } from './records.mts';

/** #sec-primitive-operator-blocks: erase result metadata, retaining its representation. */
export function RawOperatorResultType(type: TypeRecord, seen = new Map<TypeRecord, TypeRecord>()): TypeRecord {
  const prior = seen.get(type);
  if (prior) return prior;
  seen.set(type, type);
  let result = type;
  if (type.Kind === 'parameterized') result = RawOperatorResultType(type.Base, seen);
  if (type.Kind === 'union' || type.Kind === 'intersection') {
    result = { ...type, Members: type.Members.map((member) => RawOperatorResultType(member, seen)) };
  }
  if (type.Kind === 'primitive' && type.Name === 'vector') {
    const lane = type.Arguments[0];
    if (lane && typeof lane !== 'number') {
      result = { ...type, Arguments: [RawOperatorResultType(lane, seen), ...type.Arguments.slice(1)] };
    }
  }
  seen.set(type, result);
  return result;
}
