import { Value } from '../value.mts';
import { StringValue } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import { EnforceAnnotation } from '../abstract-ops/runtime-types.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  CopyDataProperties,
  InitializeReferencedBinding,
  OrdinaryObjectCreate,
  PutValue,
  ResolveBinding,
} from '#self';
import type { EnvironmentRecord, PropertyKeyValue, UndefinedValue } from '#self';

// BindingRestProperty : `...` BindingIdentifier
export function* RestBindingInitialization({ BindingIdentifier, TypeAnnotation }: ParseNode.BindingRestProperty, value: Value, environment: EnvironmentRecord | UndefinedValue, excludedNames: readonly PropertyKeyValue[]) {
  // 1. Let lhs be ? ResolveBinding(StringValue of BindingIdentifier, environment).
  const lhs = Q(yield* ResolveBinding(StringValue(BindingIdentifier), environment, BindingIdentifier.strict));
  // 2. Let restObj be OrdinaryObjectCreate(%Object.prototype%).
  const restObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  // 3. Perform ? CopyDataProperties(restObj, value, excludedNames).
  Q(yield* CopyDataProperties(restObj, value, excludedNames));
  // proposal-runtime-types #sec-typed-destructuring: a rest's annotation is the
  // type of what it COLLECTS - an object type, since an object rest collects an
  // Object - and is enforced at this binding as any annotation is. It is the
  // one position in a destructuring pattern whose contents the author has not
  // named, which is why leaving it untypeable typed the wrong half of the
  // pattern.
  const bound = TypeAnnotation
    ? Q(yield* EnforceAnnotation(TypeAnnotation, restObj))
    : restObj;
  // 4. If environment is undefined, return PutValue(lhs, restObj).
  if (environment === Value.undefined) {
    return yield* PutValue(lhs, bound);
  }
  // 5. Return InitializeReferencedBinding(lhs, restObj).
  return yield* InitializeReferencedBinding(lhs, bound);
}
