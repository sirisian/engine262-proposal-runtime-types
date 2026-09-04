import { Value } from '../value.mts';
import { PublishedClassTypeOf } from '../type-system/check.mts';
import { Q } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { AssociateClassType } from '../abstract-ops/runtime-types.mts';
import { ClassDefinitionEvaluation, DecoratorListEvaluation } from './all.mts';
import { surroundingAgent } from '#self';

/** https://tc39.es/ecma262/#sec-class-definitions-runtime-semantics-evaluation */
// ClassExpression :
//   `class` ClassTail
//   `class` BindingIdentifier ClassTail
export function* Evaluate_ClassExpression(ClassExpression: ParseNode.ClassExpression): ValueEvaluator {
  const { BindingIdentifier, ClassTail, Decorators } = ClassExpression;
  const sourceText = ClassExpression.sourceText;
  const decorators = Decorators ? Q(yield* DecoratorListEvaluation(Decorators)) : [];
  let value;
  if (!BindingIdentifier) {
    // 1. Let value be ? ClassDefinitionEvaluation of ClassTail with arguments undefined and ''
    value = Q(yield* ClassDefinitionEvaluation(ClassTail, Value.undefined, Value(''), sourceText, decorators));
  } else {
    // 1. Let className be StringValue of BindingIdentifier.
    const className = StringValue(BindingIdentifier);
    // 2. Let value be ? ClassDefinitionEvaluation of ClassTail with arguments className and className.
    value = Q(yield* ClassDefinitionEvaluation(ClassTail, className, className, sourceText, decorators));
  }
  // proposal-runtime-types: associate the class type with its constructor.
  if (surroundingAgent.feature('runtime-types')) {
    const published = PublishedClassTypeOf(ClassExpression as unknown as object);
    AssociateClassType(value, GetTypeObject({
      Kind: 'nominal',
      Declaration: ClassExpression,
      Arguments: [],
      Constructor: value,
      // As at ClassDeclaration: the relation
      // reads these two and this record carried neither.
      Base: published?.Kind === 'nominal' ? published.Base : undefined,
      Structure: published?.Kind === 'nominal' ? published.Structure : undefined,
    }));
  }
  return value;
}
