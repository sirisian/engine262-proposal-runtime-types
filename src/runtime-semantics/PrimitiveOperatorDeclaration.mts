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
  // Each parameter is carried with its CONSTRAINT, because the constraint names
  // the meta type the block speaks for: `<D: Dim>` binds D to Dim's PORTION of
  // the receiver's metadata, not to the whole of it. Binding the whole is what
  // made a Dim block's result carry a bounds portion it never mentioned, which
  // #sec-primitive-operator-blocks refuses - every meta type with no matching
  // definition contributes its `default` instead.
  const blockParameterNames: string[] = [];
  const blockParameterConstraints: (unknown | null)[] = [];
  for (const tp of (node as { TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string }, TypeParameterConstraint?: unknown }[] } | null }).TypeParameters?.TypeParameterList ?? []) {
    if (typeof tp.BindingIdentifier?.name === 'string') {
      blockParameterNames.push(tp.BindingIdentifier.name);
      blockParameterConstraints.push(tp.TypeParameterConstraint ?? null);
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
      (castFn as { IsPrimitiveOperator?: boolean }).IsPrimitiveOperator = true;
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
    // expression happens to be. This is the same lesson at a second site.
    //
    // UNLESS the block is PARAMETERIZED. `primitive float64 <D: Dim>` declares
    // operators "for each parameterization its parameters admit", and `D` names
    // nothing until an invocation supplies a receiver - so the nodes are kept
    // and resolved at dispatch with `D` bound. That is not the earlier mistake
    // of resolving a name already fixed at declaration; this is a
    // parameter whose value IS the invocation.
    const first = e.FormalParameters[0] as { TypeAnnotation?: ParseNode.TypeAnnotation | null } | undefined;
    let parameterType: TypeRecord | null = null;
    let deferred;
    // #sec-primitive-operator-blocks: an operator may carry TYPE PARAMETERS OF
    // ITS OWN - `operator +.<B2>(rhs: float64.<B2>)` - which is how the
    // ARGUMENT's metadata gets a name. The block's parameters name the
    // RECEIVER's; without the operator's, nothing about the argument can reach
    // the return type, which is what `rescale` needs to say what a converted
    // operand's bounds mean in the result's units.
    const operatorParameterNames = ((e.TypeParameters?.TypeParameterList ?? []) as readonly {
      BindingIdentifier?: { name?: string },
    }[]).map((tp) => tp.BindingIdentifier?.name ?? '').filter((n) => n !== '');
    if (blockParameterNames.length > 0 || operatorParameterNames.length > 0) {
      deferred = {
        parameterNames: blockParameterNames,
        operatorParameterNames,
        parameterConstraints: blockParameterConstraints,
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
