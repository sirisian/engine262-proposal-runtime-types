import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { SetPendingPlacement, ValidatePlacement } from '../abstract-ops/placement.mts';
import { SetPendingSoATypeArguments } from '../intrinsics/SoA.mts';
import { SetPendingThreadLocalTypeArguments } from '../intrinsics/Synchronization.mts';
import { Q } from '../completion.mts';
import { TargetTypedNewType } from '../type-system/check.mts';
import { displayType } from '../type-system/records.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { isArray } from '../utils/language.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { StampTypedCollection } from '../abstract-ops/runtime-types.mts';
import { NumberValue, ObjectValue, Value } from '../value.mts';
import { ArgumentListEvaluation } from './all.mts';
import { ResolveBinding } from '../execution-context/ExecutionContext.mts';
import { isOrdinaryObject, surroundingAgent } from '#self';
import {
  Assert,
  Construct,
  GetValue,
  IsConstructor,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-evaluatenew */
function* EvaluateNew(constructExpr: ParseNode.LeftHandSideExpression, args: undefined | ParseNode.Arguments, placementArgs?: readonly ParseNode.AssignmentExpressionOrHigher[] | null) {
  // 1. Assert: constructExpr is either a NewExpression or a MemberExpression.
  // 2. Assert: arguments is either empty or an Arguments.
  Assert(args === undefined || isArray(args));
  // 3. Let ref be the result of evaluating constructExpr.
  // Refused BEFORE the callee is evaluated. `Span` is deliberately not a global
  // binding, so evaluating it first raises `"Span" is not defined` and the
  // refusal below never runs - the same ordering trap the view constructor has.
  if (surroundingAgent.feature('runtime-types') && constructExpr.type === 'TypeArgumentsExpression'
      && (constructExpr as unknown as { Expression?: { type?: string, name?: string } }).Expression?.type === 'IdentifierReference'
      && (constructExpr as unknown as { Expression: { name?: string } }).Expression.name === 'Span') {
    // proposal-runtime-types #sec-span-type: `new Span.<T>()` is refused because
    // there is nothing for such a construction to ALLOCATE - a window is a view
    // of storage someone else owns. `Span.<T>(buffer)` is a call rather than a
    // construction for the same reason: it reinterprets bytes that exist.
    //
    // Refused HERE so it says that. `Span` is deliberately not a global binding
    // - a window is a way of viewing storage rather than a class of object - so
    // without this the evaluation reached identifier resolution and reported
    // `"Span" is not defined`, telling an author the type does not exist when it
    // does and works in every other position.
    return Throw.TypeError('a window is a view of existing storage; use `Span.<T>(buffer, ...)`');
  }
  const ref = Q(yield* Evaluate(constructExpr));
  // 4. Let constructor be ? GetValue(ref).
  const constructor = Q(yield* GetValue(ref as never));
  let argList;
  // 5. If arguments is empty, let argList be a new empty List.
  if (args === undefined) {
    argList = [];
  } else { // 6. Else,
    // a. Let argList be ? ArgumentListEvaluation of arguments.
    argList = Q(yield* ArgumentListEvaluation(args));
  }
  // 7. If IsConstructor(constructor) is false, throw a TypeError exception.
  if (!IsConstructor(constructor)) {
    return Throw.TypeError('$1 is not a constructor', constructor);
  }
  // proposal-runtime-types (soa.md): `new SoA.<T, N>()` carries its element type
  // and extent as TYPE arguments, and the constructor needs them before it can
  // size anything - the columns ARE the type argument. Resolved here, where the
  // callee node is in hand, and handed over as a pending value for the same
  // reason the placement backing is: a constructor takes value arguments, and
  // these are not values.
  if (surroundingAgent.feature('runtime-types') && constructExpr.type === 'TypeArgumentsExpression') {
    const spec = constructExpr as unknown as ParseNode.TypeArgumentsExpression;
    const baseName = spec.Expression.type === 'IdentifierReference'
      ? (spec.Expression as unknown as { name: string }).name
      : undefined;
    if (baseName === 'SoA') {
      const soaArgs: TypeRecord[] = [];
      for (const argNode of spec.TypeArguments.TypeArgumentList) {
        const record = Q(yield* TypeNodeToTypeRecord(argNode));
        // The extent arrives as a literal record wrapping a Number, as every
        // numeric type argument does; the constructor wants the number.
        soaArgs.push(record.Kind === 'literal' && record.Value instanceof NumberValue
          ? (Number((record.Value as unknown as { value: number }).value) as unknown as TypeRecord)
          : record);
      }
      SetPendingSoATypeArguments(soaArgs);
    }
    // proposal-runtime-types #sec-threadlocal-objects: `ThreadLocal.<T>` needs
    // its T for the same reason - "an agent that has not written the storage
    // reads DefaultValueOf(_T_)", and the constructor cannot ask for a default
    // of a type it was never given. The intercept above already has the name in
    // hand, so this is a second branch rather than a second interception.
    if (baseName === 'ThreadLocal') {
      const tlArgs: TypeRecord[] = [];
      for (const argNode of spec.TypeArguments.TypeArgumentList) {
        tlArgs.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      SetPendingThreadLocalTypeArguments(tlArgs);
    }
  }
  // The placement is VALIDATED before the constructor runs: the extent depends
  // only on the arguments and the type's layout, and checking it afterwards
  // would let a constructor with side effects run for a placement that can
  // never happen.
  let placementBacking;
  if (surroundingAgent.feature('runtime-types') && placementArgs !== undefined && placementArgs !== null) {
    const placementValues: Value[] = [];
    for (const argNode of placementArgs) {
      placementValues.push(Q(yield* GetValue(Q(yield* Evaluate(argNode)))));
    }
    placementBacking = Q(yield* ValidatePlacement(constructor as ObjectValue, placementValues));
    // The instance takes the placement as it is CREATED, before its fields are
    // initialized, so the constructor writes into the buffer rather than into
    // properties that would then have to be moved and could not be deleted.
    SetPendingPlacement(placementBacking);
  }
  // 8. Return ? Construct(constructor, argList).
  let constructed;
  try {
    constructed = Q(yield* Construct(constructor, argList));
  } finally {
    // Cleared whatever happened, so a failed construction cannot leave a
    // placement waiting for the next unrelated one.
    SetPendingPlacement(undefined);
  }
  // proposal-runtime-types, the PLACEMENT forms: `new(buffer, byteOffset,
  // byteLength) Type(args)`. The parser has built these arguments since the
  // form was added and NOTHING consumed them, so a placement construction
  // allocated fresh storage and silently discarded the buffer it was handed -
  // which reads as support.
  //
  // The instance is constructed first and then BOUND to the buffer, so the
  // constructor body runs exactly as it does for a fresh allocation and its
  // field writes land in the buffer through the same store path. The
  // alternative - binding before construction - would need the constructor to
  // know it is being placed.

  // proposal-runtime-types: `new Set.<uint8>()` carries its type arguments on
  // the construction, and nothing was carrying them to the object - the
  // specialization form handles a generic ALIAS and returns the plain
  // constructor for a library generic, so the collection came back unstamped
  // and every method went unchecked. An annotation happens to make this
  // unnecessary, since the binding's boundary stamps instead, which is why the
  // common spelling worked and the direct one did not (F73).
  if (surroundingAgent.feature('runtime-types')
      && constructExpr.type === 'TypeArgumentsExpression'
      && constructed instanceof ObjectValue) {
    const spec = constructExpr as unknown as ParseNode.TypeArgumentsExpression;
    const baseName = spec.Expression.type === 'IdentifierReference'
      ? (spec.Expression as unknown as { name: string }).name
      : undefined;
    if (baseName === 'Set' || baseName === 'Map' || baseName === 'WeakSet' || baseName === 'WeakMap') {
      const argRecords: TypeRecord[] = [];
      for (const argNode of spec.TypeArguments.TypeArgumentList) {
        argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      // Through StampTypedCollection, which REFUSES the entries a seed already
      // put in that do not fit: `new Set.<uint8>(["a"])` used to build a
      // `Set.<uint8>` holding the String "a", because the stamp lands on the
      // RESULT of Construct and the constructor consumed the seed before it.
      // Stamping earlier is not available - there is no object until the
      // construction makes one - so the check happens on the way in instead.
      Q(yield* StampTypedCollection(constructed, argRecords));
    }
  }
  // D8: a SUBCLASS of a specialization. `class M extends Map.<string, uint8> {}`
  // followed by `new M()` reaches neither stamping path - the construction is a
  // plain IdentifierReference, so the branch above does not fire, and there is
  // no annotation whose boundary would adopt it - so the instance came back
  // unstamped and every method went unchecked, which is F73 one level along.
  //
  // The arguments are recorded on the class constructor when its heritage is
  // evaluated, and read back here off the constructor that was actually called.
  //
  // Walked up the constructor's [[Prototype]] chain rather than read directly,
  // so `class N extends M {}` inherits from `M`. An earlier attempt read the
  // field off the called constructor alone, on the assumption that ordinary
  // property lookup would do the walking - it does not: this is an INTERNAL
  // field on the object record, not a JS-visible property, so nothing inherits
  // it without being asked to. The grandchild silently came back untyped.
  if (surroundingAgent.feature('runtime-types')
      && constructed instanceof ObjectValue && constructor instanceof ObjectValue
      && (constructed as { TypedCollection?: readonly unknown[] }).TypedCollection === undefined) {
    let ctor: Value = constructor;
    let inherited: readonly TypeRecord[] | undefined;
    while (ctor instanceof ObjectValue) {
      const found = (ctor as { CollectionTypeArguments?: readonly TypeRecord[] }).CollectionTypeArguments;
      if (found !== undefined) {
        inherited = found;
        break;
      }
      // `Prototype` is declared on ~OrdinaryObject~, not on every ObjectValue -
      // an exotic object need not have the slot - so the walk has to check
      // before reading it, and stops at anything that does not.
      if (!isOrdinaryObject(ctor)) {
        break;
      }
      ctor = ctor.Prototype;
    }
    if (inherited !== undefined) {
      Q(yield* StampTypedCollection(constructed, inherited));
    }
  }
  return constructed;
}

/** https://tc39.es/ecma262/#sec-new-operator-runtime-semantics-evaluation */
//   NewExpression :
//     `new` NewExpression
//     `new` MemberExpression Arguments
export function* Evaluate_NewExpression(node: ParseNode.NewExpression): ValueEvaluator {
  const { MemberExpression, Arguments } = node;
  const placementArgs = (node as { PlacementArguments?: readonly ParseNode.AssignmentExpressionOrHigher[] | null }).PlacementArguments;
  if (!Arguments) {
    // 1. Return ? EvaluateNew(NewExpression, empty).
    return Q(yield* EvaluateNew(MemberExpression, undefined, placementArgs));
  } else {
    // 1. Return ? EvaluateNew(MemberExpression, Arguments).
    return Q(yield* EvaluateNew(MemberExpression, Arguments, placementArgs));
  }
}

/**
 * proposal-runtime-types sec-new-expressions: `new` `.` Arguments - target-typed
 * construction.
 *
 * The checker recorded the position's contextual type against this node, because
 * only it knows what a position requires. That record is a STATIC description
 * whose [[Constructor]] is empty - the constructor is installed when the class
 * definition runs - so the class is reached instead through the binding its
 * declaration introduces, which is live by the time this evaluates.
 */
export function* Evaluate_TargetTypedNew(node: ParseNode.TargetTypedNew): ValueEvaluator {
  const t = TargetTypedNewType(node as object);
  if (!t || t.Kind !== 'nominal') {
    return Throw.SyntaxError('$1 requires a contextual type', Value('new.()'));
  }
  let ctor = (t as unknown as { Constructor?: Value }).Constructor;
  if (!ctor || !IsConstructor(ctor)) {
    const name = (t.Declaration as unknown as { BindingIdentifier?: { name?: string } })?.BindingIdentifier?.name;
    if (typeof name === 'string') {
      const ref = Q(yield* ResolveBinding(Value(name), undefined, false));
      ctor = Q(yield* GetValue(ref as never));
    }
  }
  if (!ctor || !IsConstructor(ctor)) {
    return Throw.TypeError('$1 is not a constructor', Value(displayType(t)));
  }
  const argList = Q(yield* ArgumentListEvaluation(node.Arguments));
  return Q(yield* Construct(ctor as never, argList as readonly Value[]));
}
