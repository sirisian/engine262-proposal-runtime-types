import type { TypeRecord } from './records.mts';
import { ObjectValue, ReferenceRecord, JSStringValue, EnvironmentRecord, RefBindingHolder,
  EnsureCompletion, Evaluate, GetValue, IsDataDescriptor, type PropertyKeyValue, type NormalCompletion, type Value,
  type ValueEvaluator, type ParseNode } from '#self';

// These keys are internal completions, immutable bindings or data descriptors, never returned values,
// function values or shared syntax. A forwarded dependency is only a candidate
// until the receiving function's own result admission succeeds.
const accepted = new WeakMap<object, TypeRecord>();
const forwarded = new WeakMap<object, TypeRecord>();

function sourceNominal(type: TypeRecord | undefined): type is Extract<TypeRecord, { Kind: 'nominal' }> {
  return type?.Kind === 'nominal' && type.Declaration.type === 'ClassDeclaration'
    && !type.DeclarationIdentity && type.Arguments.length === 0;
}

/** Complete only an unresolved dependency of the same nominal declaration. */
export function InstantiateReturnDependency(type: TypeRecord, completion?: object): TypeRecord {
  const dependency = completion && forwarded.get(completion);
  if (!sourceNominal(type) || type.Constructor || !sourceNominal(dependency)
    || dependency.Declaration !== type.Declaration || !(dependency.Constructor instanceof ObjectValue)) return type;
  return { ...type, Constructor: dependency.Constructor };
}

/** Called after the ordinary boundary check, with that boundary's target. */
export function RetainCheckedResult(completion: object | undefined, type: TypeRecord): void {
  if (!completion) return;
  if (sourceNominal(type) && type.Constructor instanceof ObjectValue) accepted.set(completion, type);
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
  if (descriptor && IsDataDescriptor(descriptor)) TransferResultDependency(completion, descriptor);
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
