import type { ParseNode } from '../parser/ParseNode.mts';
import { OrdinaryFunctionCreate, RegisterPrimitiveCast, RegisterPrimitiveOperator } from '../abstract-ops/all.mts';
import { TypeNodeToTypeRecord, pushTypeParameterFrame, popTypeParameterFrame } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { MetadataCapturesOf, ComponentCapturesOf, NestedComponentCapturesOf } from '../type-system/specialization-patterns.mts';
import { ComponentListTypeNodes, FixedTypeSubtrees } from '../type-system/component-patterns.mts';
import { surroundingAgent, EnsureCompletion, Q, Value, type PlainEvaluator } from '#self';

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
  // #sec-primitive-operator-blocks: the block's list is a specialization list
  // of captures, `<const D: Dim>`, each naming its meta type.
  for (const tp of MetadataCapturesOf(node as { TypeParameters?: ParseNode.TypeParameters | null })) {
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
      // THE BLOCK'S OWN TYPE PARAMETERS ARE IN SCOPE for the cast's target.
      // #sec-primitive-operator-blocks: "`primitive` T P `{` ... `}`, where ...
      // P is an optional |TypeParameters| constrained by a meta type", and the
      // grammar is `primitive` TypeName TypeParameters? `{` ... `}`.
      //
      // They were collected and never bound, so `primitive complex<T: P> {
      // operator complex.<T>() { ... } }` - the form the clause defines - answered
      // `"T" is not defined`. Only the P-less form worked, and there
      // `complex.<P>` has to be read as a COMPONENT argument, because `complex`
      // takes one: the cast's target became `complex.<{ phase: int.<32> }>`, a
      // shape rather than the meta type family, and covered no parameterization.
      //
      // That is why a metadata crossing into `complex.<float64>.<{ ... }>` or
      // `rational.<64>.<{ ... }>` was refused in the annotation spelling while
      // `:=` succeeded: the cast the program declared was never a candidate.
      const blockFrame = new Map<string, TypeRecord>();
      // A COMPONENT capture ranges over every component in a cast's target:
      // `operator complex.<E>.<T>()` covers the T-parameterization of every
      // complex, so E is bound to an open parameter, which CastCoversTarget
      // lets stand for any argument in its position.
      for (const component of ComponentCapturesOf(node as ParseNode.PrimitiveOperatorDeclaration)) {
        blockFrame.set(component.BindingIdentifier.name, { Kind: 'parameter', Name: component.BindingIdentifier.name } as TypeRecord);
      }
      for (let i = 0; i < blockParameterNames.length; i += 1) {
        const constraint = blockParameterConstraints[i];
        if (constraint) {
          blockFrame.set(blockParameterNames[i]!, Q(yield* TypeNodeToTypeRecord(constraint as never)));
        }
      }
      let blockFramePushed = false;
      if (blockFrame.size > 0) {
        pushTypeParameterFrame(blockFrame);
        blockFramePushed = true;
      }
      let target: TypeRecord;
      try {
        target = Q(yield* TypeNodeToTypeRecord(e.Type));
      } finally {
        if (blockFramePushed) {
          popTypeParameterFrame();
        }
      }
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
    if (e.type !== 'OperatorDefinition' || !e.OperatorName || !e.FormalParameters) {
      continue;
    }
    // #sec-primitive-operator-blocks: "any number of definitions without a
    // body may match, each contributing its own meta type's portion of the
    // result through its return type". A bodyless binary definition is
    // registered with no function: dispatch reads its types, and the
    // primitive operation computes the value.
    const bodyless = !e.FunctionBody;
    if (bodyless && e.FormalParameters.length !== 1) {
      continue;
    }
    // The receiver is the primitive, so the body sees the left operand as
    // `this` exactly as a class operator's body does.
    const opFn = bodyless ? Value.undefined : OrdinaryFunctionCreate(
      surroundingAgent.intrinsic('%Function.prototype%'),
      'operator',
      e.FormalParameters,
      e.FunctionBody!,
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
    const components = ComponentCapturesOf(node as ParseNode.PrimitiveOperatorDeclaration);
    // A component list holding a nested pattern is bound by the matcher; its
    // type nodes are resolved here, once, since the matcher is synchronous.
    const componentList = (node as ParseNode.PrimitiveOperatorDeclaration).ComponentParameters;
    let componentResolved: Map<object, TypeRecord> | undefined;
    if (componentList && NestedComponentCapturesOf(node as ParseNode.PrimitiveOperatorDeclaration).length > 0) {
      componentResolved = new Map();
      for (const typeNode of ComponentListTypeNodes(componentList)) {
        const resolved = EnsureCompletion(yield* TypeNodeToTypeRecord(typeNode as never));
        if (resolved.Type === 'normal') {
          componentResolved.set(typeNode, resolved.Value as unknown as TypeRecord);
        }
      }
    }
    const declaration = node as ParseNode.PrimitiveOperatorDeclaration;
    const captureDeclarations = [...(declaration.ComponentParameters?.Captures ?? []), ...(declaration.MetadataParameters?.Captures ?? [])];
    let operandResolved: Map<object, TypeRecord> | undefined;
    const operandNode = first?.TypeAnnotation?.Type as unknown as ParseNode | undefined;
    if (operandNode && captureDeclarations.length > 0) {
      operandResolved = new Map();
      // The captures' domains too: a metadata capture's portion is projected
      // by the meta type its domain names.
      const domains = captureDeclarations.map((c) => c.TypeParameterDomain as unknown as ParseNode | null).filter((d): d is ParseNode => !!d);
      for (const fixed of [...FixedTypeSubtrees(operandNode, new Set(captureDeclarations.map((c) => c.BindingIdentifier.name))), ...domains]) {
        const resolved = EnsureCompletion(yield* TypeNodeToTypeRecord(fixed as never));
        if (resolved.Type === 'normal') {
          operandResolved.set(fixed, resolved.Value as unknown as TypeRecord);
        }
      }
    }
    if (blockParameterNames.length > 0 || operatorParameterNames.length > 0 || components.length > 0 || bodyless || componentResolved) {
      deferred = {
        captureDeclarations,
        operandResolved,
        parameterNames: blockParameterNames,
        operatorParameterNames,
        parameterConstraints: blockParameterConstraints,
        componentNames: components.map((c) => c.BindingIdentifier.name),
        componentIndices: components.map((c) => c.Index),
        componentList: componentResolved ? componentList : undefined,
        componentPrimitive: componentResolved ? typeName : undefined,
        componentResolved,
        parameterTypeNode: first?.TypeAnnotation?.Type,
        returnTypeNode: e.TypeAnnotation?.Type,
      };
    } else if (first?.TypeAnnotation) {
      const resolved = EnsureCompletion(yield* TypeNodeToTypeRecord(first.TypeAnnotation.Type));
      if (resolved.Type === 'normal') {
        parameterType = resolved.Value as unknown as TypeRecord;
      }
    }
    if (!bodyless) {
      (opFn as { IsPrimitiveOperator?: boolean }).IsPrimitiveOperator = true;
    }
    const key = e.FormalParameters.length === 0 ? `unary ${e.OperatorName}` : e.OperatorName;
    RegisterPrimitiveOperator(typeName, key, opFn, parameterType, deferred, e);
  }
  return undefined;
}
