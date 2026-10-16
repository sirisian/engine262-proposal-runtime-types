import { ObjectValue, TypedNumberValue, NumberValue, BooleanValue, BigIntValue, SymbolValue, Value, JSStringValue, type Descriptor } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import { TupleBackingLength } from './tuple-storage.mts';
import { CanonicalizeType } from './intern.mts';
import { OrdinaryNominalPrototype, OrdinaryNominalPath, IsValueTypeClass } from '#self';

export type ScalarRestType = TypeRecord & { Kind: 'primitive' | 'nominal' };
export type ScalarRestRunRecord = { Type: ScalarRestType, Min: number, Max: number };
export type ScalarRestPattern = readonly ScalarRestRunRecord[];
export type ScalarRestStorage = ObjectValue & { ScalarRestGuards?: readonly ScalarRestPattern[] };

export function ScalarRestProjection(pattern: ScalarRestPattern): TypeRecord {
  return CanonicalizeType({ Kind: 'union', Members: pattern.filter((run) => run.Max > 0).map((run) => run.Type) });
}

export function ScalarRestShape(pattern: ScalarRestPattern): import('./tuple-storage.mts').TupleStorageShape {
  return { Positions: [], Rest: ScalarRestProjection(pattern), ScalarRuns: pattern };
}

export function ScalarRestLengthRange(pattern: ScalarRestPattern): { min: number, max: number } {
  return { min: pattern.reduce((n, run) => n + run.Min, 0), max: pattern.reduce((n, run) => n + run.Max, 0) };
}

export function ScalarRestLengthAllowed(object: ObjectValue, length: number): boolean {
  return (ScalarRestOwner(object).ScalarRestGuards ?? []).every((pattern) => {
    const range = ScalarRestLengthRange(pattern);
    return length >= range.min && length <= range.max;
  });
}

/** Compact required scalar positions, finite array runs and dynamic runs.
 * Defaults, metadata, object elements and unresolved counts stay outside this
 * specialization. Do not expand a declared extent into individual records. */
export function ScalarRestsOf(type: TypeRecord): ScalarRestPattern | undefined {
  return OrdinaryRestsOf(type, false);
}

/** Already-admitted identity class values can also carry a correlated ordinary
 * prototype guard. This does not enable speculative nominal conversion. */
export function OrdinaryRestsOf(type: TypeRecord, nominal = true): ScalarRestPattern | undefined {
  if (type.Kind !== 'tuple') return undefined;
  const result: ScalarRestRunRecord[] = [];
  const active = new Set<TypeRecord>();
  const append = (item: TypeRecord, Min: number, Max: number): boolean => {
    if (item.Kind === 'nominal' && nominal && OrdinaryNominalPrototype(item) && !IsValueTypeClass(item)
        && !(item.Declaration as { TypeParameters?: { TypeParameterList?: readonly unknown[] } }).TypeParameters?.TypeParameterList?.length) {
      if (Max > 0) result.push({ Type: item, Min, Max });
      return true;
    }
    if (item.Kind !== 'primitive') return false;
    if (item.Name === 'int' || item.Name === 'uint') {
      if (item.Arguments.length !== 1 || typeof item.Arguments[0] !== 'number') return false;
    } else if (!['number', 'string', 'boolean', 'bigint', 'symbol', 'null', 'undefined', 'float16', 'float32', 'float64'].includes(item.Name)
        || item.Arguments.length !== 0) return false;
    if (Max > 0) result.push({ Type: item, Min, Max });
    return true;
  };
  const visit = (tuple: TypeRecord & { Kind: 'tuple' }): boolean => {
    if (active.has(tuple)) return false;
    active.add(tuple);
    for (const element of tuple.Elements) {
      if (element.Initial !== 'none' || element.DeclaredDefault) return false;
      if (!element.Rest) {
        if (!append(element.Type, 1, 1)) return false;
      } else if (element.Type.Kind === 'tuple') {
        if (!visit(element.Type)) return false;
      } else if (element.Type.Kind === 'array') {
        const count = element.Type.Extent;
        if (count === 'dynamic') {
          if (!append(element.Type.Element, 0, Infinity)) return false;
        } else if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
            || !append(element.Type.Element, count, count)) return false;
      } else return false;
    }
    active.delete(tuple);
    return true;
  };
  if (!visit(type) || !Number.isSafeInteger(ScalarRestLengthRange(result).min)) return undefined;
  return result;
}

/** Possible occupancy comes only from declared counts and total length. */
function intervals(pattern: ScalarRestPattern, length: number): { Type: ScalarRestType, start: number, end: number }[] {
  const range = ScalarRestLengthRange(pattern);
  if (length < range.min || length > range.max) return [];
  let prefixMin = 0;
  let prefixMax = 0;
  return pattern.map((run, i) => {
    if (run.Max === 0) return { Type: run.Type, start: 0, end: 0 };
    const suffix = ScalarRestLengthRange(pattern.slice(i + 1));
    const low = Math.max(prefixMin, length - suffix.max - run.Max);
    const high = Math.min(prefixMax, length - suffix.min - run.Min);
    const start = low;
    const end = run.Max === Infinity ? length - suffix.min : high + run.Max;
    prefixMin += run.Min;
    prefixMax += run.Max;
    return { Type: run.Type, start, end: low <= high ? end : start };
  }).filter((run) => run.start < run.end);
}

export function ScalarRestTypeAt(pattern: ScalarRestPattern, index: number, length: number): TypeRecord | undefined {
  const members = intervals(pattern, length).filter((run) => index >= run.start && index < run.end).map((run) => run.Type);
  return members.length ? CanonicalizeType({ Kind: 'union', Members: members }) : undefined;
}

export function ScalarRestRun(pattern: ScalarRestPattern, index: number, length: number, direction: number): number {
  const boundaries = [0, length, ...intervals(pattern, length).flatMap((run) => [run.start, run.end])];
  return direction === 1 ? Math.min(...boundaries.filter((n) => n > index)) - index
    : index - Math.max(...boundaries.filter((n) => n <= index)) + 1;
}

export function ScalarRestMember(value: Value, type: ScalarRestType): boolean {
  if (type.Kind === 'nominal') {
    const target = OrdinaryNominalPrototype(type);
    return value instanceof ObjectValue && target !== undefined && Array.isArray(OrdinaryNominalPath(value, target));
  }
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

type State = readonly [run: number, used: number];
type States = readonly State[];

function closure(pattern: ScalarRestPattern, states: States): States {
  const result = new Map<string, State>();
  for (let [run, used] of states) {
    for (;;) {
      result.set(`${run}:${used}`, [run, used]);
      if (run === pattern.length || used < pattern[run]!.Min) break;
      run += 1;
      used = 0;
    }
  }
  return [...result.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function advance(pattern: ScalarRestPattern, states: States, admits: (type: ScalarRestType) => boolean): States {
  const next: State[] = [];
  for (const [run, used] of states) {
    const item = pattern[run];
    if (item && used < item.Max && admits(item.Type)) next.push([run, item.Max === Infinity ? 0 : used + 1]);
  }
  return closure(pattern, next);
}

export function ScalarRestsAccept(pattern: ScalarRestPattern, values: readonly Value[],
  member: (value: Value, type: ScalarRestType) => boolean = ScalarRestMember): boolean {
  const range = ScalarRestLengthRange(pattern);
  if (values.length < range.min || values.length > range.max) return false;
  let states = closure(pattern, [[0, 0]]);
  for (const value of values) {
    states = advance(pattern, states, (type) => member(value, type));
    if (!states.length) return false;
  }
  return states.some(([run]) => run === pattern.length);
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

/** Greedy counts for the first acquired pattern, subject to every other
 * guard. Retain all reachable states: a finite separator can require giving
 * back an earlier match of the same type. No conversions run in this search. */
export function AssignScalarRests(patterns: readonly ScalarRestPattern[], length: number,
  admits: (index: number, type: ScalarRestType) => boolean,
  compatible: (index: number, chosen: ScalarRestType, required: ScalarRestType) => boolean = (_index, chosen, required) => SameType(chosen, required)): ScalarRestType[] | undefined {
  if (patterns.some((pattern) => {
    const range = ScalarRestLengthRange(pattern);
    return length < range.min || length > range.max;
  })) return undefined;
  const first = patterns[0]!;
  const others = patterns.slice(1);
  const memo = new Map<string, number[] | null>();
  const solve = (run: number, at: number, states: readonly States[]): number[] | null => {
    if (run === first.length) return at === length && states.every((set, i) => set.some(([r]) => r === others[i]!.length)) ? [] : null;
    const key = `${run}:${at}:${JSON.stringify(states)}`;
    if (memo.has(key)) return memo.get(key)!;
    const item = first[run]!;
    const suffix = ScalarRestLengthRange(first.slice(run + 1));
    const limit = Math.min(item.Max, length - at - suffix.min);
    const next = [states];
    let count = 0;
    while (count < limit && admits(at + count, item.Type)) {
      const advanced = next[count]!.map((set, i) => advance(others[i]!, set, (type) => compatible(at + count, item.Type, type)));
      if (advanced.some((set) => !set.length)) break;
      next.push(advanced);
      count += 1;
    }
    for (; count >= Math.max(item.Min, length - at - suffix.max); count -= 1) {
      const tail = solve(run + 1, at + count, next[count]!);
      if (tail) {
        const result = [count, ...tail];
        memo.set(key, result);
        return result;
      }
    }
    memo.set(key, null);
    return null;
  };
  const counts = solve(0, 0, others.map((pattern) => closure(pattern, [[0, 0]])));
  return counts?.flatMap((count, i) => Array.from({ length: count }, () => first[i]!.Type));
}
