import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RequireType } from '../abstract-ops/runtime-types.mts';
import { IsOfType, BindTypeArgumentRecords, toNumericArgument, currentTypeParameterFrame } from './runtime.mts';
import { InferredConstTypeOf } from './check.mts';
import { substituteParametersNamed } from './unify.mts';
import { makePrimitive, type TypeRecord } from './records.mts';
import { InstantiateReturnDependency, ForwardResultDependency, RetainCheckedResult } from '#self';

/** The inferred initialization boundary, shared by plain and extracted bindings. */
export function* EnforceInferredBinding(node: object, value: Value, initializer?: ParseNode | null, completion?: object): PlainEvaluator<{ value: Value, type?: TypeRecord }> {
  const inferred = InferredConstTypeOf(node);
  if (!inferred) return { value };
  const parameters = currentTypeParameterFrame();
  let target = parameters ? (substituteParametersNamed(inferred, parameters) ?? inferred) : inferred;
  if (completion) target = InstantiateReturnDependency(target, ForwardResultDependency(completion, completion));
  if (target.Kind === 'nominal' && !target.LibraryName) {
    const typeParameters = (target.Declaration as ParseNode.ClassDeclaration | undefined)?.TypeParameters?.TypeParameterList;
    if (typeParameters?.length && target.Arguments.length) {
      const argumentsAsTypes = target.Arguments.map((arg) => typeof arg === 'number'
        ? { Kind: 'literal', Value: Value(arg), Base: makePrimitive('number') } as TypeRecord : arg);
      const bound = Q(yield* BindTypeArgumentRecords(typeParameters, argumentsAsTypes, [], 'inferred const'));
      target = { ...target, Arguments: bound.map(toNumericArgument) };
    }
  }
  // Const stabilizes its destination, not a replaceable callee or property
  // used by the initializer. Keep the initialization boundary.
  let writtenInitializer = initializer;
  while (writtenInitializer?.type === 'ParenthesizedExpression') writtenInitializer = writtenInitializer.Expression;
  if (target.Kind === 'object' && writtenInitializer?.type === 'ObjectLiteral') {
    // The declaration on a fresh accessor checks its result when called.
    // Inferring the object's type must not call that accessor now.
    const accessors = new Set(writtenInitializer.PropertyDefinitionList.flatMap((member) => {
      if (member.type !== 'MethodDefinition' || member.UniqueFormalParameters) return [];
      const key = member.ClassElementName as { name?: string, value?: string };
      return [key.name ?? key.value];
    }));
    target = { ...target, Properties: target.Properties.filter((property) => !accessors.has(property.key as string)) };
  }
  // Inference preserves an existing value. Do not promote an already
  // conforming plain aggregate into typed storage merely to check it.
  if (!Q(yield* IsOfType(value, target))) {
    value = Q(yield* RequireType(value, target));
  }
  RetainCheckedResult(completion, target);
  return { value, type: target };
}
