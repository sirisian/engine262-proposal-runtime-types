import { Completion, type NormalCompletion } from '../completion.mts';
import { EnvironmentRecord } from '../execution-context/Environment.mts';
import { JSStringValue, ReferenceRecord, type Value } from '../value.mts';
import { InTypeComputation } from './budget.mts';
import { isTypeObject } from './intern.mts';
import type { TypeRecord } from './records.mts';
import { resolvedAliasContext, resolvedNamespaceAliasContext } from './resolving-aliases.mts';

// Context belongs to a particular type-producing evaluation, never its public
// Type Object, shared syntax, ordinary binding or property descriptor.
const contexts = new WeakMap<object, TypeRecord>();

export function TypeResultContextOf(result: object): TypeRecord | undefined {
  return contexts.get(result);
}

/** A type expression supplies its resolved context before public interning. */
export function RetainTypeResultContext<T extends NormalCompletion<Value>>(result: T, context: TypeRecord): T {
  if (InTypeComputation() && isTypeObject(result.Value)) contexts.set(result, context);
  return result;
}

/** Called only after GetValue has performed the ordinary binding/namespace
 * read, including its TDZ and reference-liveness checks. */
export function ReadTypeResultContext(reference: ReferenceRecord, result: NormalCompletion<Value>): void {
  if (!InTypeComputation() || !isTypeObject(result.Value) || !(reference.ReferencedName instanceof JSStringValue)
    || reference.Base === 'unresolvable') return;
  const name = reference.ReferencedName.stringValue();
  const context = reference.Base instanceof EnvironmentRecord
    ? resolvedAliasContext(reference.Base, name)
    : resolvedNamespaceAliasContext(reference.Base, name);
  if (context) contexts.set(result, context);
}

/** Forward only a successful, value-preserving result. The general result
 * machinery also visits bindings/descriptors; those are deliberate barriers. */
export function TransferTypeResultContext<T extends object>(from: object, to: T): T {
  if (!(from instanceof Completion) || !(to instanceof Completion)) return to;
  const context = (from.Type === 'normal' || from.Type === 'return')
    && (to.Type === 'normal' || to.Type === 'return') && from.Value === to.Value
    ? contexts.get(from) : undefined;
  if (context) contexts.set(to, context);
  else contexts.delete(to);
  return to;
}
