import { Value } from '../value.mts';
import { Q } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { ObjectMemberDecoratorContext } from './PropertyDefinitionEvaluation.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import {
  PropertyDefinitionEvaluation_PropertyDefinitionList,
} from './all.mts';
import { surroundingAgent, OrdinaryObjectCreate } from '#self';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-evaluation */
//   ObjectLiteral :
//     `{` `}`
//     `{` PropertyDefinitionList `}`
//     `{` PropertyDefinitionList `,` `}`
export function* Evaluate_ObjectLiteral({ PropertyDefinitionList, Decorators }: ParseNode.ObjectLiteral): ValueEvaluator {
  // 1. Let obj be OrdinaryObjectCreate(%Object.prototype%).
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (PropertyDefinitionList.length === 0) {
    return obj;
  }
  // 2. Perform ? PropertyDefinitionEvaluation of PropertyDefinitionList with arguments obj and true.
  Q(yield* PropertyDefinitionEvaluation_PropertyDefinitionList(PropertyDefinitionList, obj, Value.true));
  // 3. Return obj.
  // proposal-runtime-types decorators.md "Order": members apply before their
  // container and the container last, so an object literal's own decorators run
  // once its members are in place - the same rule, and the same placement, as a
  // class and its members.
  if (surroundingAgent.feature('runtime-types') && Decorators?.length) {
    Q(yield* ApplyDecorators(Decorators, Q(yield* ObjectMemberDecoratorContext('Object', Value.undefined, obj as Value))));
  }
  return obj;
}
