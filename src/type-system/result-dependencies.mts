import type { TypeRecord } from './records.mts';
import { ObjectValue, ReferenceRecord, JSStringValue, EnvironmentRecord, RefBindingHolder,
  EnsureCompletion, Evaluate, GetValue, IsDataDescriptor, type PropertyKeyValue, type SymbolValue, NormalCompletion, type Value,
  type ValueEvaluator, type ParseNode } from '#self';

// These keys are internal completions, immutable bindings or data descriptors, never returned values,
// function values or shared syntax. A forwarded dependency is only a candidate
// until the receiving function's own result admission succeeds.
const accepted = new WeakMap<object, TypeRecord>();
const forwarded = new WeakMap<object, TypeRecord>();
const receivers = new WeakMap<ReferenceRecord, TypeRecord>();
// Construction evidence is a ledger of source contributions, not a snapshot of
// current member values. A decorator can change backing before admission.
const constructions = new WeakMap<ObjectValue, Map<string | SymbolValue, TypeRecord>>();

function propertyIdentity(key: PropertyKeyValue): string | SymbolValue {
  return key instanceof JSStringValue ? key.stringValue() : key;
}

function sourceNominal(type: TypeRecord | undefined): type is Extract<TypeRecord, { Kind: 'nominal' }> {
  return type?.Kind === 'nominal' && type.Declaration.type === 'ClassDeclaration'
    && !type.DeclarationIdentity && type.Arguments.length === 0;
}

/** Complete matching unresolved nominal leaves in a private named-object view. */
export function InstantiateReturnDependency(type: TypeRecord, completion?: object): TypeRecord {
  const dependency = completion && forwarded.get(completion);
  const seen = new Map<TypeRecord, Map<TypeRecord, TypeRecord>>();
  const complete = (target: TypeRecord, evidence: TypeRecord | undefined): TypeRecord => {
    if (sourceNominal(target) && !target.Constructor && sourceNominal(evidence)
        && evidence.Declaration === target.Declaration && evidence.Constructor instanceof ObjectValue) {
      return { ...target, Constructor: evidence.Constructor };
    }
    if (target.Kind !== 'object' || evidence?.Kind !== 'object') return target;
    let alternatives = seen.get(target);
    if (!alternatives) seen.set(target, alternatives = new Map());
    const prior = alternatives.get(evidence);
    if (prior) return prior;
    const copy = { ...target };
    alternatives.set(evidence, copy);
    const properties = new Map(evidence.Properties.map((property) => [property.key, property.type]));
    copy.Properties = target.Properties.map((property) => ({
      ...property, type: complete(property.type, properties.get(property.key)),
    }));
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
    if (type) construction?.set(propertyIdentity(key), type);
    else construction?.delete(propertyIdentity(key));
  }
}

/** A later literal method/accessor replaces the earlier source contribution.
 * This does not apply to an arbitrary backing mutation by a decorator. */
export function ForgetObjectPropertyContribution(object: ObjectValue, key: PropertyKeyValue): void {
  constructions.get(object)?.delete(propertyIdentity(key));
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
    Properties: [...entries].map(([key, type]) => ({
      key, type, optional: false, readonly: false,
    })),
  });
  return result;
}

function project(type: TypeRecord | undefined, key: PropertyKeyValue, result: object): void {
  if (type?.Kind !== 'object') return;
  const identity = propertyIdentity(key);
  const property = type.Properties.find((entry) => entry.key === identity);
  // A checked view is authoritative, including an erased member. A missing
  // named entry (for example a fresh accessor) supplies no replacement target.
  if (property) RetainCheckedResult(result, property.type);
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
