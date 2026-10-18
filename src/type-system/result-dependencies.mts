import type { TypeRecord } from './records.mts';
import { ObjectValue } from '#self';

// These keys are individual internal completions, never returned values,
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
  return to;
}

/** A returned call contributes evidence, not an exemption from admission. */
export function ForwardResultDependency<T extends object>(from: object, to: T): T {
  const type = accepted.get(from);
  if (type) forwarded.set(to, type);
  return to;
}
