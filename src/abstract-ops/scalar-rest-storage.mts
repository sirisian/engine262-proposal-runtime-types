import { AssignScalarRests, ScalarRestsAccept, ScalarRestMember, ScalarRestOwner, ScalarRestValues, ScalarRestGuardsAccept, ScalarRestLengthAllowed, type ScalarRestPattern } from '../type-system/scalar-rests.mts';
import { CarriedTypeRecordOf, DefaultValueOf, RuntimeTypeOf } from '../type-system/runtime.mts';
import { TupleBackingLength, TupleStorageTypeAt, TupleResizePreserves, type TupleStorageShape } from '../type-system/tuple-storage.mts';
import { IsSubtype } from '../type-system/relations.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { ObjectValue, ReferenceValue, Value, type Descriptor } from '../value.mts';
import { Q, EnsureCompletion, type ThrowCompletion } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { RequireType, ConvertValue, ScalarRestConversionApplicable, LookupClassOperator } from './runtime-types.mts';
import { SameValue, Throw, isDecimalObject, isRationalObject, isFloat128Object, OwnMemberDeclarationOf, OrdinaryNominalPrototype, IsValueTypeClass, Construct, IsConstructor, AcquireNominalPrototype } from '#self';

type Convert = (value: Value, type: TypeRecord) => ValueEvaluator;
export type ScalarRestItem = { value?: Value, convert?: boolean };
type Candidate = { value?: Value, execute?: () => ValueEvaluator };

/** A declaration-resolved, simple constructor parameter can supply a pure
 * applicability proof. Never invoke construction or resolve an annotation in
 * the caller's environment to discover that proof. More general signatures
 * and conversion operators need their own selected plans. */
function* nominalConstructorCandidate(value: Value, type: TypeRecord): PlainEvaluator<{ candidate: Candidate } | { failure: ThrowCompletion } | undefined> {
  if (type.Kind !== 'nominal' || !OrdinaryNominalPrototype(type) || value instanceof ReferenceValue) return undefined;
  const ctor = type.Constructor;
  if (!ctor || !IsConstructor(ctor)) return undefined;
  const formals = (ctor as { FormalParameters?: readonly {
    type: string, Initializer?: unknown, TypeAnnotation?: unknown, Ref?: boolean, Optional?: boolean,
  }[] }).FormalParameters;
  if (formals?.length !== 1 || formals[0]!.type !== 'SingleNameBinding' || formals[0]!.Initializer
      || formals[0]!.Ref || formals[0]!.Optional) return undefined;
  const declared = OwnMemberDeclarationOf(ctor, 'constructor', false, 'ClassMethod')?.type;
  const parameter = declared?.Kind === 'function' && declared.Signatures.length === 1
    ? declared.Signatures[0]!.Parameters[0] : undefined;
  if (parameter?.Ref || parameter?.Rest || parameter?.Optional) return undefined;
  if (formals[0]!.TypeAnnotation && !parameter) return undefined;
  const target = parameter?.Type;
  if (target && target.Kind !== 'any') {
    if (target.Kind !== 'primitive' && target.Kind !== 'nominal') return undefined;
    if (target.Kind === 'nominal' && IsValueTypeClass(target)) return undefined;
    if (!ScalarRestMember(value, target)) {
      if (!pureScalarConversion(value, target, RequireType)) return undefined;
      const admitted = EnsureCompletion(yield* RequireType(value, target));
      if (admitted.Type === 'throw') return { failure: admitted };
      if (admitted.Type !== 'normal' || !ScalarRestMember(admitted.Value, target)) return undefined;
    }
  }
  return { candidate: { execute: function* () {
    // Parameter admission still happens at the actual invocation. It is a
    // checked boundary even for an explicitly cast enclosing tuple.
    const result = Q(yield* Construct(ctor, [value]));
    if (!ScalarRestMember(result, type)) return Throw.TypeError('a constructor returned a value outside its selected rest');
    Q(AcquireNominalPrototype(result, type));
    return result;
  } } };
}

/** These real numeric values use ObjectValue only as an interpreter
 * representation. Their intrinsic payload conversions are pure; ordinary
 * objects, metadata and a potentially selected class operator are not. */
function pureScalarConversion(value: Value, type: TypeRecord, convert: Convert): boolean {
  if (type.Kind !== 'primitive') return false;
  const carried = CarriedTypeRecordOf(value);
  if (value instanceof ReferenceValue || (carried !== undefined && carried.Kind !== 'primitive')) return false;
  if (!(value instanceof ObjectValue)) return true;
  if (!isDecimalObject(value) && !isRationalObject(value) && !isFloat128Object(value)) return false;
  // These explicit cases return through the intrinsic payload path before
  // CheckedConvertValue's class-operator fallback. An unrelated operator must
  // not turn a pure, failed candidate into a selected effectful conversion.
  if (convert === ConvertValue && type.Kind === 'primitive'
      && ['string', 'boolean', 'number', 'bigint', 'int', 'uint', 'float16', 'float32', 'float64'].includes(type.Name)) return true;
  return LookupClassOperator(value, `convert ${displayType(type)}`) === null;
}

/** Pure intrinsic scalar computations may be retained. User conversion code is
 * only classified here and runs once, after assignment has been selected. */
export function* ConvertScalarRestItems(patterns: readonly ScalarRestPattern[], items: readonly ScalarRestItem[],
  convert: Convert, accepts: (index: number, type: TypeRecord, value?: Value) => boolean = () => true): PlainEvaluator<Value[]> {
  const unchanged = AssignScalarRests(patterns, items.length, (i, type) => items[i]!.value !== undefined
    && ScalarRestMember(items[i]!.value!, type) && accepts(i, type, items[i]!.value),
  (i, _chosen, required) => ScalarRestMember(items[i]!.value!, required));
  if (unchanged) return items.map((item) => item.value!);
  const types = [...new Set(patterns[0]!.map((run) => run.Type))];
  const candidates: Map<TypeRecord, Candidate>[] = [];
  let failure: ThrowCompletion | undefined;
  for (const item of items) {
    const row = new Map<TypeRecord, Candidate>();
    const retain = (type: TypeRecord, value?: Value) => {
      if (accepts(candidates.length, type, value)) row.set(type, { value });
    };
    for (const type of types) {
      if (item.value === undefined) {
        // Nominal defaults require selected effectful planning, outside this
        // already-admitted identity-class specialization.
        if (type.Kind === 'nominal') continue;
        const value = Q(yield* DefaultValueOf(type));
        if (value !== undefined) retain(type, value);
      } else if (ScalarRestMember(item.value, type)) retain(type, item.value);
      else if (item.convert) {
        if (type.Kind === 'nominal') {
          const candidate = Q(yield* nominalConstructorCandidate(item.value, type));
          if (candidate && 'failure' in candidate) failure ??= candidate.failure;
          else if (candidate && accepts(candidates.length, type)) row.set(type, candidate.candidate);
        } else if (pureScalarConversion(item.value, type, convert)) {
          const result = EnsureCompletion(yield* convert(item.value, type));
          if (result.Type === 'normal' && ScalarRestMember(result.Value, type)) retain(type, result.Value);
          else if (result.Type === 'throw') failure ??= result;
        } else if (ScalarRestConversionApplicable(item.value, type, convert)) retain(type);
      }
    }
    candidates.push(row);
  }
  const selected = AssignScalarRests(patterns, items.length, (i, type) => candidates[i]!.has(type), (i, chosen, required) => {
    const value = candidates[i]!.get(chosen)?.value;
    return value === undefined ? IsSubtype(chosen, required, []) : ScalarRestMember(value, required);
  });
  if (!selected) return failure ?? Throw.TypeError('no ordered scalar rest assignment admits the sequence');
  const values: Value[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    const type = selected[i]!;
    const candidate = candidates[i]!.get(type)!;
    let value = candidate.value;
    if (value === undefined) {
      if (candidate.execute) {
        value = Q(yield* candidate.execute());
      } else {
        value = Q(yield* convert(items[i]!.value!, type));
      }
    }
    if (!ScalarRestMember(value, type)) return Throw.TypeError('a scalar conversion returned a value outside its selected rest');
    values.push(value);
  }
  if (!patterns.every((pattern) => ScalarRestsAccept(pattern, values))) {
    return Throw.TypeError('conversion effects invalidated the completed rest sequence');
  }
  return values;
}

/** Retain data rather than replaying property Gets. Reentrant changes to any
 * consulted element or acquired guard invalidate this receiving operation. */
export function* PrepareScalarRestValues(object: ObjectValue, length: number,
  supplied: ReadonlyMap<number, Descriptor>, converting: boolean | ReadonlySet<number>): PlainEvaluator<Value[] | undefined> {
  const owner = ScalarRestOwner(object);
  const guards = owner.ScalarRestGuards;
  if (!guards?.length) return undefined;
  const oldLength = TupleBackingLength(owner);
  const old = ScalarRestValues(owner, oldLength);
  if (!old) return Throw.TypeError('a scalar rest guard requires initialized own data elements');
  const items = Array.from({ length }, (_, index): ScalarRestItem => supplied.has(index)
    ? { value: supplied.get(index)!.Value, convert: converting === true || (converting !== false && converting.has(index)) }
    : { value: old[index] });
  const backing = owner as typeof owner & { TypedTuple?: TupleStorageShape, TypedElement?: TypeRecord,
    TypedProperties?: Map<string, { TypeRecord: TypeRecord }> };
  const tuple = backing.TypedTuple;
  const element = backing.TypedElement;
  if (!ScalarRestLengthAllowed(owner, length) || (tuple && !TupleResizePreserves(tuple, oldLength, length))) {
    return Throw.TypeError('scalar rest resize would change a surviving position contract or required count');
  }
  const values = Q(yield* ConvertScalarRestItems(guards, items, RequireType, (index, type, value) => {
    const targets = [tuple ? TupleStorageTypeAt(tuple, index, length) : undefined, element,
      backing.TypedProperties?.get(String(index))?.TypeRecord].filter((target): target is TypeRecord => target !== undefined);
    return targets.every((target) => IsSubtype(type, target, []) || (value !== undefined && IsSubtype(RuntimeTypeOf(value), target, [])));
  }));
  const now = ScalarRestValues(owner, oldLength);
  if (owner.ScalarRestGuards !== guards || backing.TypedTuple !== tuple || backing.TypedElement !== element || TupleBackingLength(owner) !== oldLength
      || !now || old.some((value, i) => !SameValue(value, now[i]!))) {
    return Throw.TypeError('scalar rest backing changed during conversion');
  }
  if (!ScalarRestGuardsAccept(owner, values)) return Throw.TypeError('the converted sequence violates its scalar rest guards');
  return values;
}
