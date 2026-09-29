import { Descriptor, INDEX_TYPE, ObjectValue, TypedNumberValue, Value } from '../value.mts';
import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import type { TypeRecord } from './records.mts';
import { ReportedLayoutOf } from './layout.mts';
import { Throw } from '#self';

const installed = new WeakSet<ObjectValue>();

/** #sec-layout-properties: observable own constants, installed once layout is final. */
export function* InstallTypeLayoutProperties(target: ObjectValue, record: TypeRecord): ValueEvaluator {
  if (installed.has(target)) return Value.undefined;
  const complete = (type: TypeRecord, seen = new Set<TypeRecord>()): boolean => {
    if (seen.has(type) || seen.size >= 256 || type.Kind === 'parameter' || type.Kind === 'deferred') return false;
    seen.add(type);
    if (type.Kind === 'array') return complete(type.Element, seen);
    if (type.Kind === 'parameterized') return complete(type.Base, seen);
    if (type.Kind === 'nominal' && type.EnumMembers === undefined && !type.LibraryName && !type.Constructor) return false;
    return true;
  };
  if (!complete(record)) return Value.undefined;
  const layout = ReportedLayoutOf(record);
  if (!layout) return Value.undefined;
  for (const key of ['bitLength', 'byteLength', 'alignment'] as const) {
    // Class statics cannot silently replace (or be replaced by) layout facts.
    if (target.properties.has(Value(key))) return Throw.TypeError('a declared property conflicts with the fixed type layout member $1', Value(key));
  }
  for (const key of ['bitLength', 'byteLength', 'alignment'] as const) {
    const ok = Q(yield* target.DefineOwnProperty(Value(key), Descriptor({
      Value: new TypedNumberValue(layout[key], INDEX_TYPE),
      Writable: Value.false, Enumerable: Value.false, Configurable: Value.false,
    })));
    if (ok === Value.false) return Throw.TypeError('cannot install the fixed type layout member $1', Value(key));
  }
  installed.add(target);
  return Value.undefined;
}
