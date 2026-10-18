import { anyType, type TypeRecord, type PropertyTypeRecord } from './records.mts';
import { ObjectValue, ReferenceRecord, JSStringValue, EnvironmentRecord, RefBindingHolder,
  EnsureCompletion, Evaluate, GetValue, IsDataDescriptor, type PropertyKeyValue, SymbolValue, NormalCompletion, type Value,
  type ValueEvaluator, type ParseNode, IsSymbolicPropertyKey, InitializedSymbolKey } from '#self';

// These keys are internal completions, immutable bindings or data descriptors, never returned values,
// function values or shared syntax. A forwarded dependency is only a candidate
// until the receiving function's own result admission succeeds.
const accepted = new WeakMap<object, TypeRecord>();
const forwarded = new WeakMap<object, TypeRecord>();
const receivers = new WeakMap<ReferenceRecord, TypeRecord>();
// Construction evidence is a ledger of source contributions, not a snapshot of
// current member values. A decorator can change backing before admission.
const constructions = new WeakMap<ObjectValue, Map<string | SymbolValue, { type?: TypeRecord, keyDependency?: SymbolValue }>>();
// A construction can supply a key without supplying a value contract, notably
// for an accessor. This is distinct from a checked member whose target is any.
const keyOnly = new WeakSet<PropertyTypeRecord>();

function propertyIdentity(key: PropertyKeyValue): string | SymbolValue {
  return key instanceof JSStringValue ? key.stringValue() : key;
}

function sourceNominal(type: TypeRecord | undefined): type is Extract<TypeRecord, { Kind: 'nominal' }> {
  return type?.Kind === 'nominal' && type.Declaration.type === 'ClassDeclaration'
    && !type.DeclarationIdentity && type.Arguments.length === 0;
}

/** Complete matching nominal and Symbol-key dependencies in a private view. */
export function InstantiateReturnDependency(type: TypeRecord, completion?: object): TypeRecord {
  const dependency = completion && forwarded.get(completion);
  const seen = new Map<TypeRecord, Map<TypeRecord | undefined, TypeRecord>>();
  const complete = (target: TypeRecord, evidence: TypeRecord | undefined): TypeRecord => {
    if (sourceNominal(target) && !target.Constructor && sourceNominal(evidence)
        && evidence.Declaration === target.Declaration && evidence.Constructor instanceof ObjectValue) {
      return { ...target, Constructor: evidence.Constructor };
    }
    if (target.Kind !== 'object') return target;
    let alternatives = seen.get(target);
    if (!alternatives) seen.set(target, alternatives = new Map());
    const prior = alternatives.get(evidence);
    if (prior) return prior;
    const copy = { ...target };
    alternatives.set(evidence, copy);
    const contributed = evidence?.Kind === 'object' ? evidence.Properties : [];
    const properties = new Map(contributed.map((property) => [property.key, property]));
    const keys = new Map(contributed.filter((property) => property.keyDependency)
      .map((property) => [property.keyDependency!, property]));
    copy.Properties = target.Properties.map((property) => {
      let key = property.key;
      let keyDependency = property.keyDependency;
      if (IsSymbolicPropertyKey(key)) {
        // A selected contribution supplies its activation before a lexical
        // fallback. Recursive calls must not use the caller's own fresh key.
        const supplied = keys.get(key)?.key;
        const actual = supplied instanceof SymbolValue && !IsSymbolicPropertyKey(supplied)
          ? supplied : InitializedSymbolKey(key);
        if (actual) {
          keyDependency = key;
          key = actual;
        }
      }
      return { ...property, key, keyDependency, type: complete(property.type, properties.get(key)?.type) };
    });
    return copy;
  };
  return complete(type, dependency);
}

/** Called after the ordinary boundary check, with that boundary's target. */
export function RetainCheckedResult(completion: object | undefined, type: TypeRecord): void {
  if (!completion) return;
  if (type.Kind === 'object' || (sourceNominal(type) && type.Constructor instanceof ObjectValue)) accepted.set(completion, type);
  else accepted.delete(completion);
}

/** Preserve an admitted contract when the interpreter wraps the same result. */
export function TransferResultDependency<T extends object>(from: object, to: T): T {
  const type = accepted.get(from);
  if (type) accepted.set(to, type);
  else accepted.delete(to);
  return to;
}

/** A fresh data property's committed descriptor owns its initializer's evidence.
 * Replacing or deleting that descriptor cannot leave evidence on the new slot.
 * Call only after an ordinary literal/copy/iterator-result creation succeeds. */
export function RetainPropertyResult(object: ObjectValue, key: PropertyKeyValue, completion: object): void {
  const descriptor = object.properties.get(key);
  if (descriptor && IsDataDescriptor(descriptor)) {
    TransferResultDependency(completion, descriptor);
    const construction = constructions.get(object);
    const type = accepted.get(completion);
    const identity = propertyIdentity(key);
    const keyDependency = construction?.get(identity)?.keyDependency;
    if (type || keyDependency) construction?.set(identity, { type, keyDependency });
    else construction?.delete(identity);
  }
}

/** A later literal method/accessor replaces the earlier source contribution.
 * This does not apply to an arbitrary backing mutation by a decorator. */
export function ForgetObjectPropertyContribution(object: ObjectValue, key: PropertyKeyValue): void {
  constructions.get(object)?.delete(propertyIdentity(key));
}

/** Retain the already evaluated key's source identity, independently of data. */
export function RetainObjectPropertyKey(object: ObjectValue, key: PropertyKeyValue, keyDependency?: SymbolValue): void {
  const construction = constructions.get(object);
  const identity = propertyIdentity(key);
  const type = construction?.get(identity)?.type;
  if (key instanceof SymbolValue && keyDependency) construction?.set(identity, { type, keyDependency });
  else if (type) construction?.set(identity, { type });
  else construction?.delete(identity);
}

export function RetainCopiedPropertyKey(object: ObjectValue, key: PropertyKeyValue, source?: object): void {
  const type = source && accepted.get(source);
  const identity = propertyIdentity(key);
  const property = type?.Kind === 'object' ? type.Properties.find((entry) => entry.key === identity) : undefined;
  RetainObjectPropertyKey(object, key, property?.keyDependency);
}

export function BeginObjectResult(object: ObjectValue): void {
  constructions.set(object, new Map());
}

export function EndObjectResult(object: ObjectValue): void {
  constructions.delete(object);
}

/** Finish a fresh object's contribution without reading any program value. */
export function CompleteObjectResult(object: ObjectValue): NormalCompletion<ObjectValue> {
  const result = NormalCompletion(object);
  const entries = constructions.get(object);
  if (entries?.size) accepted.set(result, {
    Kind: 'object', IndexSignatures: [],
    Properties: [...entries].map(([key, entry]): PropertyTypeRecord => {
      const property = { key, type: entry.type ?? anyType, keyDependency: entry.keyDependency, optional: false, readonly: false };
      if (!entry.type) keyOnly.add(property);
      return property;
    }),
  });
  return result;
}

function project(type: TypeRecord | undefined, key: PropertyKeyValue, result: object): void {
  if (type?.Kind !== 'object') return;
  const identity = propertyIdentity(key);
  const property = type.Properties.find((entry) => entry.key === identity);
  // A checked view is authoritative, including an erased member. A missing
  // named entry (for example a fresh accessor) supplies no replacement target.
  if (property && !keyOnly.has(property)) RetainCheckedResult(result, property.type);
}

/** Project the established source view, independently of replaceable backing. */
export function ProjectResultDependency(source: object | undefined, key: PropertyKeyValue, result: object): void {
  project(source && accepted.get(source), key, result);
}

/** Keep the base view until ordinary key conversion and reference checks finish. */
export function RetainPropertyReceiver(source: object, reference: ReferenceRecord): ReferenceRecord {
  const type = accepted.get(source);
  if (type?.Kind === 'object') receivers.set(reference, type);
  return reference;
}

export function ReadPropertyResult(reference: ReferenceRecord, key: PropertyKeyValue, result: object): void {
  project(receivers.get(reference), key, result);
}

/** A returned call contributes evidence, not an exemption from admission. */
export function ForwardResultDependency<T extends object>(from: object, to: T): T {
  const type = accepted.get(from);
  if (type) forwarded.set(to, type);
  return to;
}

/** Read once and preserve only the contract of the value actually obtained. */
export function* GetResultValue(result: NormalCompletion<ReferenceRecord | Value>): ValueEvaluator {
  const read = EnsureCompletion(yield* GetValue(result.Value));
  if (read.Type !== 'normal') return read;
  // A binding read supplies its own evidence after TDZ/reference checks. Do not
  // transfer metadata from a reference evaluated before the value was read.
  if (result.Value instanceof ReferenceRecord) return read;
  return TransferResultDependency(result, read);
}

/** Value-preserving expression evaluation, including ordinary GetValue. */
export function* EvaluateResultValue(node: ParseNode.AssignmentExpressionOrHigher): ValueEvaluator {
  const result = EnsureCompletion(yield* Evaluate(node));
  if (result.Type !== 'normal') return result;
  return yield* GetResultValue(result);
}

/** Only a successfully initialized immutable ordinary binding retains evidence. */
export function RetainBindingResult(reference: ReferenceRecord, completion: object): void {
  if (!(reference.Base instanceof EnvironmentRecord) || !(reference.ReferencedName instanceof JSStringValue)) return;
  const binding = RefBindingHolder(reference.Base, reference.ReferencedName)?.bindings.get(reference.ReferencedName);
  if (!binding?.initialized || binding.mutable !== false || binding.indirect || binding.refLocation) return;
  TransferResultDependency(completion, binding);
}
