import { Value } from '../value.mts';
import {
  EnsureCompletion, type Completion, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate_Block } from './all.mts';
import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types: Runtime Semantics: Evaluation of a ConstantExpression.
 *
 * `constant { ... }` is evaluated at most once per SITE per realm. This is the
 * rule ECMA-262 already applies to a tagged template's strings array -
 * GetTemplateObject scans the realm's [[TemplateMap]] for an entry whose
 * [[Site]] is the same Parse Node - generalized from a frozen List of Strings to
 * the value of a Block.
 *
 * Keyed on the PARSE NODE rather than on anything at run time, so two closures
 * made by two calls to the same factory share one value, and a site inside a
 * loop yields the same value on every iteration. That is what a hoisted `const`
 * cannot do: hoisting is per evaluation of the declaration it sits in, and this
 * is per site.
 *
 * Lazy: the Block runs on the first evaluation that reaches it, not at module
 * evaluation, so a branch never taken costs nothing. The choice is unobservable
 * because the Block must be compile-time evaluable, which is checked as an early
 * error - a Block that cannot read anything that varies cannot tell how many
 * times it ran, except through the identity of what it returns, which is the
 * point.
 */
export function* Evaluate_ConstantExpression(node: ParseNode.ConstantExpression): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  for (const entry of realm.ConstantMap) {
    if (entry.Site === node) {
      return entry.Value;
    }
  }
  const completion = EnsureCompletion(yield* Evaluate_Block(node.Block)) as Completion<Value | void>;
  if (completion.Type !== 'normal') {
    // An abrupt completion is NOT recorded: nothing was produced, so a later
    // evaluation reaching the same site tries again rather than replaying a
    // failure it cannot distinguish from a value.
    return completion as ValueCompletion;
  }
  const value = completion.Value === undefined ? Value.undefined : completion.Value;
  realm.ConstantMap.push({ Site: node, Value: value });
  return value;
}
