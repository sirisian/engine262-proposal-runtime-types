import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ClassTypeContextOf, InterfaceTypeContextOf } from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { RequireType } from '../abstract-ops/runtime-types.mts';
import { IsOfType, BindTypeArgumentRecords, currentTypeParameterFrame, InCapturedTypeContext, instantiateTypeInFrame } from './runtime.mts';
import { InferredConstTypeOf } from './check.mts';
import { makePrimitive, type TypeRecord } from './records.mts';
import { InstantiateReturnDependency, ForwardResultDependency, RetainCheckedResult, CheckedPropertyKeyOf, InstantiateCheckedBindings, CompleteCreatedFunctionResult, surroundingAgent } from '#self';

/** Reify the checker's compact numeric arguments before runtime admission. */
export function* NormalizeInferredClassArguments(target: TypeRecord): PlainEvaluator<TypeRecord> {
  if (target.Kind === 'nominal' && !target.LibraryName) {
    const typeParameters = (target.Declaration as ParseNode.ClassDeclaration | undefined)?.TypeParameters?.TypeParameterList;
    if (typeParameters?.length && target.Arguments.length) {
      // Reification can need source constraints even when every argument was
      // inferred. Complete the declared identity before choosing that context;
      // the initializer's value must not choose its own admission target.
      target = InstantiateCheckedBindings(new Map([['target', target]]),
        surroundingAgent.runningExecutionContext.LexicalEnvironment).get('target')!;
      if (target.Kind !== 'nominal') return target;
      const captured = target.Declaration.type === 'InterfaceDeclaration' ? InterfaceTypeContextOf(target)
        : target.Constructor instanceof Value ? ClassTypeContextOf(target.Constructor) : undefined;
      const argumentsAsTypes = target.Arguments.map((arg) => typeof arg === 'number'
        ? { Kind: 'literal', Value: Value(arg), Base: makePrimitive('number') } as TypeRecord : arg);
      const bind = () => BindTypeArgumentRecords(typeParameters, argumentsAsTypes, [], 'inferred const');
      const bound = Q(yield* (captured ? InCapturedTypeContext(captured, bind) : bind()));
      target = { ...target, Arguments: bound };
    }
  }
  return target;
}

/** The inferred initialization boundary, shared by plain and extracted bindings. */
export function* EnforceInferredBinding(node: object, value: Value, initializer?: ParseNode | null, completion?: object): PlainEvaluator<{ value: Value, type?: TypeRecord }> {
  const inferred = InferredConstTypeOf(node);
  if (!inferred) return { value };
  const parameters = currentTypeParameterFrame();
  // This is the enclosing environment, not an application of any generic
  // callable stored inside the binding. Retain its own binders and substitute
  // captured inputs in both declared and published result positions.
  let target = parameters ? instantiateTypeInFrame(inferred, parameters) : inferred;
  // Preserve the checked initializer's nested nominal dependency before
  // normalization completes an outer family from the receiving environment.
  // Knowing P does not establish the local C in an inferred P<C> result.
  if (completion) target = InstantiateReturnDependency(target, ForwardResultDependency(completion, completion));
  target = Q(yield* NormalizeInferredClassArguments(target));
  target = InstantiateCheckedBindings(new Map([['result', target]]), surroundingAgent.runningExecutionContext.LexicalEnvironment).get('result')!;
  // Const stabilizes its destination, not a replaceable callee or property
  // used by the initializer. Keep the initialization boundary.
  let writtenInitializer = initializer;
  while (writtenInitializer?.type === 'ParenthesizedExpression') writtenInitializer = writtenInitializer.Expression;
  target = CompleteCreatedFunctionResult(target, value, writtenInitializer ?? undefined);
  if (target.Kind === 'object' && writtenInitializer?.type === 'ObjectLiteral') {
    // The declaration on a fresh accessor checks its result when called.
    // Inferring the object's type must not call that accessor now.
    const accessors = new Set<ReturnType<typeof CheckedPropertyKeyOf>>();
    for (const member of writtenInitializer.PropertyDefinitionList) {
      const keyNode = member.type === 'PropertyDefinition' ? member.PropertyName
        : 'ClassElementName' in member ? member.ClassElementName : member;
      if (!keyNode) continue;
      const key = CheckedPropertyKeyOf(keyNode)
        ?? ('name' in keyNode ? keyNode.name : 'value' in keyNode ? String(keyNode.value) : undefined);
      if (key === undefined) continue;
      if (member.type === 'MethodDefinition' && !member.UniqueFormalParameters) accessors.add(key);
      else accessors.delete(key); // A later data property or method replaces it.
    }
    target = { ...target, Properties: target.Properties.filter((property) => !accessors.has(property.keyDependency ?? property.key)) };
  }
  // Inference preserves an existing value. Do not promote an already
  // conforming plain aggregate into typed storage merely to check it.
  if (!Q(yield* IsOfType(value, target))) {
    value = Q(yield* RequireType(value, target));
  }
  RetainCheckedResult(completion, target);
  return { value, type: target };
}
