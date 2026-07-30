import { Value } from '../value.mts';
import {
  EnsureCompletion, Q, type Completion, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate_Block } from './all.mts';
import { Throw } from '#self';

/**
 * proposal-runtime-types #sec-do-expressions: Runtime Semantics: Evaluation.
 *
 * The plain form is a handful of lines because the machinery was already here:
 * Evaluate_StatementList threads UpdateEmpty exactly as the base specification
 * does, so a block's completion already CARRIES its completion value. All this
 * does is read it, and turn an empty completion into `undefined` - which is
 * `do {}` being `void 0`.
 *
 * An abrupt completion propagates untouched, and that is the feature rather
 * than an omission: `return`, `break`, and `continue` inside a `do` mean what
 * they mean in the surrounding code, which is what makes a `do` unlike an
 * immediately-invoked arrow.
 */
export function* Evaluate_DoExpression(node: ParseNode.DoExpression): ValueEvaluator {
  if (node.star) {
    // PLAN-do-expressions.md phase 3b. A `do *` evaluates to a generator
    // object, and the construction to copy is an ARROW's rather than a
    // generator expression's: it has no parameters and captures `this`
    // lexically, which is the whole point of the form - it exists to delete a
    // `function* () { ... }.call(this)`.
    return Q(Throw.TypeError('do * is not yet evaluated'));
  }
  const completion = EnsureCompletion(yield* Evaluate_Block(node.Block!)) as Completion<Value | void>;
  if (completion.Type !== 'normal') {
    // `return`, `break`, and `continue` leave the expression untouched, which
    // is what makes a `do` unlike an immediately-invoked arrow.
    return completion as ValueCompletion;
  }
  // An EMPTY completion is `do {}` being `void 0`.
  return completion.Value === undefined ? Value.undefined : completion.Value;
}
