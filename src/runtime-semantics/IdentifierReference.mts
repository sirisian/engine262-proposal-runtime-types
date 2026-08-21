import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ReferenceRecord } from '../value.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ResolveBinding } from '#self';

/** https://tc39.es/ecma262/#sec-identifiers-runtime-semantics-evaluation */
// IdentifierReference :
//   Identifier
//   `yield`
//   `await`
export function* Evaluate_IdentifierReference(IdentifierReference: ParseNode.IdentifierReference): PlainEvaluator<ReferenceRecord> {
  // 1. Return ? ResolveBinding(StringValue of Identifier).
  // proposal-runtime-types #sec-type-names: an ASSIGNMENT TARGET does not resolve
  // to a type name even where the text admits, so a sloppy-mode assignment
  // creates the global it creates today instead of reaching an immutable binding.
  // The `typeof` operand is excepted from admitting only, and resolves normally.
  return yield* ResolveBinding(
    StringValue(IdentifierReference),
    undefined,
    IdentifierReference.strict,
    (IdentifierReference as { exceptedFromResolution?: boolean }).exceptedFromResolution === true,
  );
}
