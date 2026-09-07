import { Value } from '../value.mts';
import { Q, X } from '../completion.mts';
import { FreshObjectLiteralTarget } from '../type-system/check.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { ObjectMemberDecoratorContext } from './PropertyDefinitionEvaluation.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import {
  PropertyDefinitionEvaluation_PropertyDefinitionList,
} from './all.mts';
import { surroundingAgent, OrdinaryObjectCreate, GetValue, IsArray, HasProperty, CreateDataProperty } from '#self';
import { IsComposite } from '../intrinsics/Composite.mts';
import { Evaluate } from '../evaluator.mts';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-evaluation */
//   ObjectLiteral :
//     `{` `}`
//     `{` PropertyDefinitionList `}`
//     `{` PropertyDefinitionList `,` `}`
export function* Evaluate_ObjectLiteral(node: ParseNode.ObjectLiteral): ValueEvaluator {
  const { PropertyDefinitionList, Decorators } = node;
  // 1. Let obj be OrdinaryObjectCreate(%Object.prototype%).
  const obj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (PropertyDefinitionList.length > 0) {
    // 2. Perform ? PropertyDefinitionEvaluation of PropertyDefinitionList with arguments obj and true.
    Q(yield* PropertyDefinitionEvaluation_PropertyDefinitionList(PropertyDefinitionList, obj, Value.true));
  }
  // proposal-runtime-types #sec-object-types: "an object literal written AT the
  // position is fresh and is being built there, so the type supplies what the
  // literal omits". The checker marked this literal with the object type it is
  // being built at, and only when that type declares a default (#sec-check-pass).
  //
  // AFTER the members, so a supplied value always wins and a default only fills
  // what the literal left out - the same order a typed composite creation uses.
  if (surroundingAgent.feature('runtime-types')) {
    const target = FreshObjectLiteralTarget(node as object);
    if (target) {
      for (const p of (target as { Properties: readonly { key: string, type: unknown, initial?: Value }[] }).Properties) {
        if (p.initial === undefined) {
          continue;
        }
        const key = Value(p.key);
        if (Q(yield* HasProperty(obj, key)) === Value.false) {
          X(CreateDataProperty(obj, key, Q(yield* ConvertValue(p.initial, p.type as never))));
        }
      }
    }
  }
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

/**
 * proposal-runtime-types decorators.md: `const e = @f Composite([0]);` gives
 * `Reflect.Tuple`, `const d = @f Composite({ a: 1 });` gives `Reflect.Record`.
 *
 * The decorated thing is an ordinary expression, so WHICH CONTEXT FIRES is
 * decided by the VALUE rather than by the syntax - and the array/object split
 * is exactly the one a composite's KIND already makes, which is why the intern
 * key carries it. A decorated expression that is neither reports `Object`,
 * since that is what it is.
 */
export function* Evaluate_DecoratedExpression({ Decorators, Expression }: ParseNode.DecoratedExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression as never));
  const value = Q(yield* GetValue(ref as never));
  if (surroundingAgent.feature('runtime-types') && Decorators?.length) {
    let kind = 'Object';
    if (IsComposite(value)) {
      kind = IsArray(value) === Value.true ? 'Tuple' : 'Record';
    }
    Q(yield* ApplyDecorators(Decorators, Q(yield* ObjectMemberDecoratorContext(kind, Value.undefined, value))));
  }
  return value;
}
