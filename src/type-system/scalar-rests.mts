import { ObjectValue, TypedNumberValue, NumberValue, BooleanValue, BigIntValue, SymbolValue, Value, JSStringValue, type Descriptor } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import { TupleBackingLength } from './tuple-storage.mts';
import { CanonicalizeType } from './intern.mts';

export type ScalarRestPattern = readonly (TypeRecord & { Kind: 'primitive' })[];
export type ScalarRestStorage = ObjectValue & { ScalarRestGuards?: readonly ScalarRestPattern[] };

export function ScalarRestProjection(pattern: ScalarRestPattern): TypeRecord {
  return CanonicalizeType({ Kind: 'union', Members: pattern });
}

/** A prefix-closed ordered language. Fixed runs, defaults, metadata and object
 * elements deliberately do not acquire this specialization. */
export function ScalarRestsOf(type: TypeRecord): ScalarRestPattern | undefined {
  if (type.Kind !== 'tuple' || type.Elements.length < 2) return undefined;
  const result: (TypeRecord & { Kind: 'primitive' })[] = [];
  for (const element of type.Elements) {
    if (!element.Rest || element.Type.Kind !== 'array' || element.Type.Extent !== 'dynamic') return undefined;
    const item = element.Type.Element;
    if (item.Kind !== 'primitive') return undefined;
    if (item.Name === 'int' || item.Name === 'uint') {
      if (item.Arguments.length !== 1 || typeof item.Arguments[0] !== 'number') return undefined;
    } else if (!['number', 'string', 'boolean', 'bigint', 'symbol', 'null', 'undefined', 'float16', 'float32', 'float64'].includes(item.Name)
        || item.Arguments.length !== 0) return undefined;
    result.push(item);
  }
  return result;
}

export function ScalarRestMember(value: Value, type: ScalarRestPattern[number]): boolean {
  if (value instanceof TypedNumberValue) {
    const numeric = value as TypedNumberValue;
    const record = numeric.TypeRecord as TypeRecord;
    if (record.Kind === 'nominal' && record.EnumMembers && record.Underlying) {
      value = new TypedNumberValue(numeric.value, record.Underlying);
    }
  }
  if (type.Name === 'null') return value === Value.null;
  if (type.Name === 'undefined') return value === Value.undefined;
  if (type.Name === 'string') return value instanceof JSStringValue;
  if (type.Name === 'boolean') return value instanceof BooleanValue;
  if (type.Name === 'bigint') return value instanceof BigIntValue;
  if (type.Name === 'symbol') return value instanceof SymbolValue;
  if (value instanceof TypedNumberValue) {
    let record = (value as TypedNumberValue).TypeRecord as TypeRecord;
    if (record.Kind === 'parameterized') record = record.Base;
    return record.Kind === 'primitive' && SameType(record, type);
  }
  return type.Name === 'number' && value instanceof NumberValue;
}

/** Earliest matching run retains every possible later continuation. */
export function ScalarRestsAccept(pattern: ScalarRestPattern, values: readonly Value[]): boolean {
  let run = 0;
  for (const value of values) {
    while (run < pattern.length && !ScalarRestMember(value, pattern[run]!)) run += 1;
    if (run === pattern.length) return false;
  }
  return true;
}

export function ScalarRestOwner(object: ObjectValue): ScalarRestStorage {
  while ('ProxyTarget' in object && object.ProxyTarget instanceof ObjectValue) object = object.ProxyTarget;
  return object as ScalarRestStorage;
}

export function ScalarRestValues(object: ObjectValue, length: number): Value[] | undefined {
  const values: Value[] = [];
  for (let i = 0; i < length; i += 1) {
    const desc = object.properties.get(Value(String(i)));
    if (!desc || desc.Value === undefined) return undefined;
    values.push(desc.Value);
  }
  return values;
}

export function ScalarRestGuardsAccept(object: ObjectValue, values: readonly Value[]): boolean {
  return ((object as ScalarRestStorage).ScalarRestGuards ?? []).every((pattern) => ScalarRestsAccept(pattern, values));
}

/** Check the final own data value, including any independent property-type
 * conversion. Returning false lets the ordinary definition fail before writing. */
export function ScalarRestDefinitionAllowed(object: ObjectValue, key: unknown, desc: Descriptor): boolean {
  if (!(key instanceof JSStringValue) || !(object as ScalarRestStorage).ScalarRestGuards) return true;
  const index = Number(key.stringValue());
  if (!Number.isInteger(index) || index < 0 || index >= 0xFFFFFFFF || String(index) !== key.stringValue()) return true;
  if (desc.Getter !== undefined || desc.Setter !== undefined) return false;
  if (desc.Value === undefined) return true;
  const length = TupleBackingLength(object);
  // Array growth is prepared and checked as a whole by GrowInitializedArray.
  if (index >= length) return true;
  const values = ScalarRestValues(object, length);
  if (!values) return false;
  values[index] = desc.Value;
  return ScalarRestGuardsAccept(object, values);
}

/** Greedy counts for the first acquired pattern, subject to all other acquired
 * patterns. State includes their run positions; no value conversions run here.
 * Recursion is over written runs, never over the length of the input. */
export function AssignScalarRests(patterns: readonly ScalarRestPattern[], length: number,
  admits: (index: number, type: ScalarRestPattern[number]) => boolean): ScalarRestPattern[number][] | undefined {
  const first = patterns[0]!;
  const memo = new Map<string, number[] | null>();
  const solve = (run: number, at: number, states: number[]): number[] | null => {
    if (run === first.length) return at === length ? [] : null;
    const key = `${run}:${at}:${states.join(',')}`;
    if (memo.has(key)) return memo.get(key)!;
    const type = first[run]!;
    let limit = 0;
    while (at + limit < length && admits(at + limit, type)) limit += 1;
    const next = states.map((state, i) => {
      const pattern = patterns[i + 1]!;
      while (state < pattern.length && !SameType(type, pattern[state]!)) state += 1;
      return state;
    });
    if (next.some((state, i) => state === patterns[i + 1]!.length)) limit = 0;
    for (let count = limit; count >= 0; count -= 1) {
      const tail = solve(run + 1, at + count, count ? next : states);
      if (tail) {
        const result = [count, ...tail];
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  };
  const counts = solve(0, 0, patterns.slice(1).map(() => 0));
  return counts?.flatMap((count, i) => Array.from({ length: count }, () => first[i]!));
}
