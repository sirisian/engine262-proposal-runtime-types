import {
  Evaluate, type ValueEvaluator, type PlainEvaluator, type ReferenceEvaluator,
} from '../evaluator.mts';
import { NormalCompletion, Q } from '../completion.mts';
import {
  Value, ReferenceRecord, ReferenceValue, ObjectValue, PrivateName, type JSStringValue,
} from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RebindRefBinding, RefBindingHolder, EnvironmentRecord } from '../execution-context/Environment.mts';
import {
  IsPropertyKey,
  IsPropertyReference,
  IsSuperReference,
  IsUnresolvableReference,
  ResolveBinding,
  ToPropertyKey,
  Throw,
} from '#self';

/**
 * proposal-runtime-types (references extension): evaluate the operand of a
 * `ref` form to the storage location it denotes. The operand must be a
 * Reference to a resolvable variable or to a property of an object (which
 * covers an array element); a plain value, a private member, a super property,
 * or a property of a primitive has no storage location a borrow could alias.
 * For a property reference the referenced name is normalized to a property key
 * once, so the location reads and writes with a stable key.
 */
export function* RequireBorrowableReference(expr: ParseNode.LeftHandSideExpression): ReferenceEvaluator {
  const ref = Q(yield* Evaluate(expr));
  if (!(ref instanceof ReferenceRecord)) {
    return Throw.TypeError('cannot take a ref of a value; a ref needs a variable, a property, or an array element');
  }
  if (IsUnresolvableReference(ref) === Value.true) {
    return Throw.ReferenceError('$1 is not defined', ref.ReferencedName as Value);
  }
  if (ref.ReferencedName instanceof PrivateName || IsSuperReference(ref) === Value.true) {
    return Throw.TypeError('cannot take a ref of a private member or a super property');
  }
  if (IsPropertyReference(ref) === Value.true) {
    if (!(ref.Base instanceof ObjectValue)) {
      return Throw.TypeError('cannot take a ref of a property of a primitive');
    }
    if (!IsPropertyKey(ref.ReferencedName)) {
      ref.ReferencedName = Q(yield* ToPropertyKey(ref.ReferencedName as Value));
    }
  }
  return ref;
}

/**
 * proposal-runtime-types (references extension):
 * RefExpression : `ref` LeftHandSideExpression
 *
 * A `ref` argument or `ref` return operand: yields a reference value, a borrow
 * of the operand's storage location. The reference value itself has no
 * observable identity; it is consumed by a `ref` parameter or a `ref` lexical
 * binding, and decays to the referent's value at any boundary that consumes a
 * value.
 */
export function* Evaluate_RefExpression({ Expression }: ParseNode.RefExpression): ValueEvaluator {
  const location = Q(yield* RequireBorrowableReference(Expression));
  return new ReferenceValue(location);
}

/**
 * proposal-runtime-types (references extension):
 * RefRebindingStatement : `ref` BindingIdentifier `=` LeftHandSideExpression `;`
 *
 * Rebinds an existing mutable ref binding to a different storage location, the
 * `ref b = a[1]` form of the design: the binding itself is redirected, and the
 * previously aliased location is not written.
 */
export function* Evaluate_RefRebindingStatement({ BindingIdentifier, Expression }: ParseNode.RefRebindingStatement): PlainEvaluator {
  const name = Value(BindingIdentifier.name) as JSStringValue;
  const lhs = Q(yield* ResolveBinding(name, undefined, BindingIdentifier.strict));
  if (IsUnresolvableReference(lhs) === Value.true) {
    return Throw.ReferenceError('$1 is not defined', name);
  }
  const location = Q(yield* RequireBorrowableReference(Expression));
  const holder = lhs.Base instanceof EnvironmentRecord ? RefBindingHolder(lhs.Base, name) : undefined;
  if (holder === undefined || !RebindRefBinding(holder, name, location)) {
    return Throw.TypeError('$1 is not a rebindable ref binding', name);
  }
  return NormalCompletion(undefined);
}
