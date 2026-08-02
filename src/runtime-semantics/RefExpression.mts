import {
  Evaluate, type ValueEvaluator, type PlainEvaluator, type ReferenceEvaluator,
} from '../evaluator.mts';
import { NormalCompletion, Q } from '../completion.mts';
import {
  Value, ReferenceRecord, ReferenceValue, ObjectValue, PrivateName, JSStringValue,
} from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { RebindRefBinding, RefBindingHolder, EnvironmentRecord } from '../execution-context/Environment.mts';
import { SoAStorageOf, SoAElementReference } from '../intrinsics/SoA.mts';
import { Get, surroundingAgent } from '#self';
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
  // proposal-runtime-types #sec-location-consuming-contexts: `g(ref first(a))`
  // re-borrows the location a call returned. The call kept its reference across
  // the boundary because the parser marked it, so what arrives here is the
  // borrow itself rather than a Reference Record, and the location it holds is
  // the one to pass on.
  if (ref instanceof ReferenceValue) {
    return ref.Location;
  }
  if (!(ref instanceof ReferenceRecord)) {
    if (expr.type === 'CallExpression' && (expr as ParseNode.CallExpression).LocationConsuming === true) {
      return Throw.TypeError('this call did not return a ref, so there is no location to borrow');
    }
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
    // #sec-layout-control: "taking a reference to [a bit-field] is a type
    // error, since it has no byte address to refer to". A reference is a
    // borrowed STORAGE LOCATION, and a field packed into part of a byte is not
    // one - reading and writing it is a shift and a mask over the byte that
    // contains it, so there is nothing for a ref to alias.
    if (surroundingAgent.feature('runtime-types') && ref.ReferencedName instanceof JSStringValue) {
      // The ECMAScript `constructor`, reached through the prototype chain -
      // NOT the host object's own `.constructor`, which is the engine class
      // that implements ObjectValue and carries no layout.
      const owner = Q(yield* Get(ref.Base, Value('constructor')));
      const layout = (owner as { InstanceLayout?: { fields: readonly { key: string, isBitField: boolean }[] } })?.InstanceLayout;
      const placement = layout?.fields.find((f) => f.key === (ref.ReferencedName as JSStringValue).stringValue());
      if (placement?.isBitField) {
        return Throw.TypeError('cannot take a ref of $1, which is a bit-field and has no byte address', ref.ReferencedName);
      }
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
  return new ReferenceValue(Q(yield* SoAElementLocationFor(location)));
}

/**
 * proposal-runtime-types soa.md: `ref s[i]` borrows A COLUMN SET AND AN INDEX,
 * not the gathered value. The gather is a copy - a value type copies - so
 * borrowing it would give a reference that writes nowhere, which is the whole
 * thing `ref` exists to avoid.
 *
 * Shared by the `ref` EXPRESSION and the `const ref x =` BINDING, which take
 * different paths to the same borrow: routing only the expression left the
 * binding - the form soa.md actually writes - silently borrowing a copy.
 */
export function* SoAElementLocationFor(location: ReferenceRecord): PlainEvaluator<ReferenceRecord> {
  if (!surroundingAgent.feature('runtime-types')
      || !(location.Base instanceof ObjectValue)
      || !(location.ReferencedName instanceof JSStringValue)) {
    return location;
  }
  const storage = SoAStorageOf(location.Base as unknown as object);
  if (storage === undefined) {
    return location;
  }
  const index = Number(location.ReferencedName.stringValue());
  if (String(index) !== location.ReferencedName.stringValue()) {
    return location;
  }
  // The element view is built ONCE, where the borrow is taken, and the marked
  // location carries it. Rebuilding it on each use would re-pin the capacity
  // and so forget that the storage had moved, which is the very invalidation
  // #sec-reference-liveness turns on.
  const view = Q(yield* SoAElementReference(storage, index));
  if (!(view instanceof ObjectValue)) {
    return location;
  }
  return new ReferenceRecord({
    Base: location.Base,
    ReferencedName: location.ReferencedName,
    Strict: location.Strict,
    ThisValue: undefined,
    IndexOperator: undefined,
    IndexSetOperator: undefined,
    SoAElement: view,
  });
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
