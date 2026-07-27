import type { ParseNode } from '../parser/ParseNode.mts';
import { OrdinaryFunctionCreate, RegisterPrimitiveCast, RegisterPrimitiveOperator } from '../abstract-ops/all.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { surroundingAgent, EnsureCompletion, Q, type PlainEvaluator } from '#self';

/**
 * proposal-runtime-types #sec-primitive-operator-blocks: `primitive T { ... }`
 * declares operators on T. The declaration PARSED and evaluated to nothing
 * before this, so a program could declare an operator, get no error, and get no
 * behaviour - which is the worst of the three outcomes, since it reads as
 * support.
 *
 * Only definitions WITH a body are registered here. A bodiless definition
 * contributes its meta type's portion of the result through its return type
 * and runs the primitive operation, which is the metadata half of the clause
 * and needs the merge rule; a definition whose name is a parameterization is
 * the implicit cast operator, whose consumer is ConvertParameterization's
 * second arm. Both are the next increment and are deliberately not guessed at
 * here.
 */
export function* Evaluate_PrimitiveOperatorDeclaration(node: ParseNode.PrimitiveOperatorDeclaration): PlainEvaluator {
  const typeName = (node.TypeName as unknown as { IdentifierReference?: { name?: string } })?.IdentifierReference?.name;
  if (typeof typeName !== 'string') {
    return undefined;
  }
  // The block's own type parameters, which stand for the receiver's metadata.
  const blockParameterNames: string[] = [];
  for (const tp of (node as { TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string } }[] } | null }).TypeParameters?.TypeParameterList ?? []) {
    if (typeof tp.BindingIdentifier?.name === 'string') {
      blockParameterNames.push(tp.BindingIdentifier.name);
    }
  }
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  for (const e of node.OperatorDefinitionList ?? []) {
    // #sec-primitive-operator-blocks: an IMPLICIT CAST is "an operator whose
    // name is a parameterization of the primitive" - so it carries a [[Type]]
    // and no [[OperatorName]], which is the discriminator. It takes no
    // parameters: the value it converts is `this`.
    if (e.type === 'OperatorDefinition' && e.OperatorName === null && e.Type && e.FunctionBody) {
      const target = Q(yield* TypeNodeToTypeRecord(e.Type));
      const castFn = OrdinaryFunctionCreate(
        surroundingAgent.intrinsic('%Function.prototype%'),
        'operator',
        e.FormalParameters ?? [],
        e.FunctionBody,
        'non-lexical-this',
        env,
        privEnv,
      );
      (castFn as { IsImplicitCast?: boolean }).IsImplicitCast = true;
      RegisterPrimitiveCast(typeName, target, castFn);
      continue;
    }
    if (e.type !== 'OperatorDefinition' || !e.OperatorName || !e.FunctionBody || !e.FormalParameters) {
      continue;
    }
    // The receiver is the primitive, so the body sees the left operand as
    // `this` exactly as a class operator's body does.
    const opFn = OrdinaryFunctionCreate(
      surroundingAgent.intrinsic('%Function.prototype%'),
      'operator',
      e.FormalParameters,
      e.FunctionBody,
      'non-lexical-this',
      env,
      privEnv,
    );
    // The parameter's type is resolved HERE, at declaration, not at dispatch:
    // the annotation names a type in the scope the block was written in, and
    // resolving it at an operator invocation would look it up wherever that
    // expression happens to be. This is F51's lesson at a second site.
    const first = e.FormalParameters[0] as { TypeAnnotation?: ParseNode.TypeAnnotation | null } | undefined;
    let parameterType: TypeRecord | null = null;
    let deferred;
    (globalThis as { __d?: string[] }).__d?.push(`params=${blockParameterNames.length} first=${first ? Object.keys(first).join("|") : "none"} ret=${e.TypeAnnotation ? "yes" : "no"}`);
    if (blockParameterNames.length > 0) {
      deferred = {
        parameterNames: blockParameterNames,
        parameterTypeNode: first?.TypeAnnotation?.Type,
        returnTypeNode: e.TypeAnnotation?.Type,
      };
    } else if (first?.TypeAnnotation) {
      const resolved = EnsureCompletion(yield* TypeNodeToTypeRecord(first.TypeAnnotation.Type));
      if (resolved.Type === 'normal') {
        parameterType = resolved.Value as unknown as TypeRecord;
      }
    }
    (opFn as { IsPrimitiveOperator?: boolean }).IsPrimitiveOperator = true;
    const key = e.FormalParameters.length === 0 ? `unary ${e.OperatorName}` : e.OperatorName;
    RegisterPrimitiveOperator(typeName, key, opFn, parameterType, deferred);
  }
  return undefined;
}
