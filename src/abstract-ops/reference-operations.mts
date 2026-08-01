import { lookupTypeParameter } from '../type-system/runtime.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import {
  ReferenceRecord,
  Value,
  PrivateName,
  JSStringValue,
  ObjectValue,
  ReferenceValue,
} from '../value.mts';
import { VectorValue, type PropertyKeyValue } from '../value.mts';
import { vectorGet, vectorSet } from '../type-system/vector-ops.mts';
import {
  Q,
  type PlainCompletion,
} from '../completion.mts';
import { __ts_cast__ } from '../utils/language.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { ResolvePrivateIdentifier } from '../execution-context/PrivateEnvironment.mts';
import {
  Assert,
  ToObject,
  Set,
  PrivateGet,
  PrivateSet,
  IsPropertyKey,
  ToPropertyKey,
  getActiveScriptId,
} from './all.mts';
import {
  DynamicParsedCodeRecord, surroundingAgent, EnvironmentRecord, GetGlobalObject, Throw, Call,
} from '#self';

/** https://tc39.es/ecma262/#sec-ispropertyreference */
export function IsPropertyReference(V: ReferenceRecord) {
  // 1. If V.[[Base]] is unresolvable, return false.
  if (V.Base === 'unresolvable') {
    return Value.false;
  }
  // 2. If V.[[Base]] is an Environment Record, return false; otherwise return true.
  return V.Base instanceof EnvironmentRecord ? Value.false : Value.true;
}
export type PropertyReference = ReferenceRecord & {
  readonly Base: Exclude<ReferenceRecord['Base'], 'unresolvable' | EnvironmentRecord>,
};

/** https://tc39.es/ecma262/#sec-isunresolvablereference */
export function IsUnresolvableReference(V: ReferenceRecord) {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[Base]] is unresolvable, return true; otherwise return false.
  return V.Base === 'unresolvable' ? Value.true : Value.false;
}

/** https://tc39.es/ecma262/#sec-issuperreference */
export function IsSuperReference(V: ReferenceRecord) {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[ThisValue]] is not empty, return true; otherwise return false.
  return V.ThisValue !== undefined ? Value.true : Value.false;
}

/** https://tc39.es/ecma262/#sec-isprivatereference */
export function IsPrivateReference(V: ReferenceRecord): V is ReferenceRecord & { readonly ReferencedName: PrivateName } {
  // 1. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 2. If V.[[ReferencedName]] is a Private Name, return true; otherwise return false.
  return V.ReferencedName instanceof PrivateName;
}

/** https://tc39.es/ecma262/#sec-getvalue */
export function* GetValue(V: ReferenceRecord | Value): PlainEvaluator<Value> {
  // 1. If V is not a Reference Record, return V.
  if (!(V instanceof ReferenceRecord)) {
    return V;
  }
  // 2. If IsUnresolvableReference(V) is true, throw a ReferenceError exception.
  if (IsUnresolvableReference(V) === Value.true) {
    // proposal-runtime-types #sec-generic-parameters-as-values: a generic
    // parameter is reachable AS A VALUE inside its declaration, since a type is
    // a value here. It is not a value binding, so ResolveBinding cannot find
    // it and the reference arrives unresolvable; the parameter frames are
    // where it lives. This is the same lookup a builder-call argument already
    // performs for a bare parameter name, generalized to any expression.
    if (surroundingAgent.feature('runtime-types') && typeof V.ReferencedName === 'object' && 'stringValue' in V.ReferencedName) {
      const bound = lookupTypeParameter((V.ReferencedName as JSStringValue).stringValue());
      if (bound !== null) {
        return GetTypeObject(bound);
      }
    }
    return Throw.ReferenceError('$1 is not defined', V.ReferencedName);
  }
  // 3. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V) === Value.true) {
    __ts_cast__<PropertyReference>(V);
    // proposal-runtime-types (spec sec-class-operators): a computed index access
    // whose base declares an index operator reads through the operator, called
    // with the index as its argument, rather than through the ordinary [[Get]].
    if (V.IndexOperator !== undefined) {
      const operatorResult = Q(yield* Call(V.IndexOperator, V.Base as Value, [V.ReferencedName as Value]));
      // proposal-runtime-types (references extension): an index operator that
      // returns a borrow (`return ref this.data[i]`) reads through to the
      // referent, so the access yields the element's current value.
      return Q(yield* DecayReferenceValue(operatorResult));
    }
    // proposal-runtime-types #sec-vector-lanes: a lane read. This is answered
    // beside the index-operator case above and before ToObject, because a
    // vector is a PRIMITIVE and boxing it loses the lanes - ToObject asserts on
    // one rather than wrapping it.
    // No feature guard: a VectorValue only exists when the feature built one,
    // so the base's own type is the whole condition.
    if ((V.Base as Value)?.type === 'Vector') {
      const lane = Q(yield* vectorGet(V.Base as VectorValue, V.ReferencedName as PropertyKeyValue));
      if (lane !== undefined) {
        return lane;
      }
      // A key a vector does not answer. It cannot fall through to ToObject,
      // which asserts on a primitive it has no wrapper for, so it is refused
      // here. The component accessors and the constant lane forms will be
      // answered above this line as they land, and until then a name that will
      // become one reports that it is not a member rather than crashing.
      return Throw.TypeError('$1 is not a member of this vector', V.ReferencedName as Value);
    }
    // a. Let baseObj be ? ToObject(V.[[Base]]).
    const baseObj = Q(ToObject(V.Base));
    // b. If IsPrivateReference(V) is true, then
    if (IsPrivateReference(V)) {
      // i. Return ? PrivateGet(baseObj, V.[[ReferencedName]]).
      return Q(yield* PrivateGet(baseObj, V.ReferencedName));
    }
    if (!IsPropertyKey(V.ReferencedName)) {
      V.ReferencedName = Q(yield* ToPropertyKey(V.ReferencedName as Value));
    }
    // c. Return ? baseObj.[[Get]](V.[[ReferencedName]], GetThisValue(V)).
    return Q(yield* baseObj.Get(V.ReferencedName, GetThisValue(V)));
  } else { // 5. Else,
    // a. Let base be V.[[Base]].
    const base = V.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? base.GetBindingValue(V.[[ReferencedName]], V.[[Strict]]).
    return Q(yield* base.GetBindingValue(V.ReferencedName as JSStringValue, V.Strict));
  }
}

/** https://tc39.es/ecma262/#sec-putvalue */
export function* PutValue(V: ReferenceRecord | Value, W: Value): PlainEvaluator {
  // 1. If V is not a Reference Record, throw a ReferenceError exception.
  if (!(V instanceof ReferenceRecord)) {
    return Throw.ReferenceError('Invalid assignment target');
  }
  // 2. If IsUnresolvableReference(V) is true, then
  if (IsUnresolvableReference(V) === Value.true) {
    // a. If V.[[Strict]] is true, throw a ReferenceError exception.
    if (V.Strict === Value.true) {
      return Throw.ReferenceError('$1 is not defined', V.ReferencedName);
    }
    // b. Let globalObj be GetGlobalObject().
    const globalObj = GetGlobalObject();
    // c. Return ? Set(globalObj, V.[[ReferencedName]], W, false).
    Q(yield* Set(globalObj, V.ReferencedName as JSStringValue, W, Value.false));
    return undefined;
  }
  // proposal-runtime-types (operatoroverloading.md): a write through an index
  // accessor goes to the class's own `set operator[]`, with the index first and the
  // value last. Without this the write created an ordinary property while the read
  // kept dispatching, so the value written was never the value read back.
  if (V.IndexSetOperator !== undefined) {
    Q(yield* Call(V.IndexSetOperator, V.Base as Value, [V.ReferencedName as Value, W]));
    return undefined;
  }
  // Where the class declares the read half and no write half, the write reaches
  // nothing the read will ever look at, so it is reported rather than silently
  // stored on an ordinary property. The design's other way to make such a write
  // work, a `get operator[]` that returns a reference, is not implemented yet.
  if (V.IndexOperator !== undefined) {
    return Throw.TypeError('this index accessor has no set operator[], so the write would not be read back');
  }
  // 5. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V) === Value.true) {
    // proposal-runtime-types #sec-vector-lanes: a lane write, answered before
    // ToObject for the reason the read is - a vector is a primitive and boxing
    // it loses the lanes. The clause admits this and records that whether it
    // should be admitted at all is an open question, since `withLane` expresses
    // the same intent without mutating a value type.
    if ((V.Base as Value)?.type === 'Vector') {
      const written = Q(yield* vectorSet(V.Base as VectorValue, V.ReferencedName as PropertyKeyValue, W));
      if (written !== undefined) {
        return undefined;
      }
    }
    // a. Let baseObj be ? ToObject(V.[[Base]]).
    const baseObj = Q(ToObject(V.Base as JSStringValue));
    // b. If IsPrivateReference(V) is true, then
    if (IsPrivateReference(V)) {
      // i. Return ? PrivateSet(baseObj, V.[[ReferencedName]], W).
      return Q(yield* PrivateSet(baseObj, V.ReferencedName, W));
    }
    if (!IsPropertyKey(V.ReferencedName)) {
      V.ReferencedName = Q(yield* ToPropertyKey(V.ReferencedName as Value));
    }
    // c. Let succeeded be ? baseObj.[[Set]](V.[[ReferencedName]], W, GetThisValue(V)).
    const succeeded = Q(yield* baseObj.Set(V.ReferencedName, W, GetThisValue(V)));
    // d. If succeeded is false and V.[[Strict]] is true, throw a TypeError exception.
    if (succeeded === Value.false && V.Strict === Value.true) {
      return Throw.TypeError('Cannot set property $1 on $2', V.ReferencedName, baseObj);
    }
    // e. Return.
    return undefined;
  } else { // 6. Else,
    // a. Let base be V.[[Base]].
    const base = V.Base;
    // b. Assert: base is an Environment Record.
    Assert(base instanceof EnvironmentRecord);
    // c. Return ? base.SetMutableBinding(V.[[ReferencedName]], W, V.[[Strict]]) (see 9.1).
    return Q(yield* base.SetMutableBinding(V.ReferencedName as JSStringValue, W, V.Strict));
  }
}

/** https://tc39.es/ecma262/#sec-getthisvalue */
export function GetThisValue(V: ReferenceRecord) {
  // 1. Assert: IsPropertyReference(V) is true.
  Assert(IsPropertyReference(V) === Value.true);
  // 2. If IsSuperReference(V) is true, return V.[[ThisValue]]; otherwise return V.[[Base]].
  if (IsSuperReference(V) === Value.true) {
    return V.ThisValue!;
  } else {
    return V.Base as Value;
  }
}

/** https://tc39.es/ecma262/#sec-initializereferencedbinding */
export function* InitializeReferencedBinding(V: PlainCompletion<ReferenceRecord>, W: Value): PlainEvaluator {
  Q(V);
  Q(W);
  // 3. Assert: V is a Reference Record.
  Assert(V instanceof ReferenceRecord);
  // 4. Assert: IsUnresolvableReference(V) is false.
  Assert(IsUnresolvableReference(V) === Value.false);
  // 5. Let base be V.[[Base]].
  const base = V.Base;
  // 6. Assert: base is an Environment Record.
  Assert(base instanceof EnvironmentRecord);
  // 7. Return base.InitializeBinding(V.[[ReferencedName]], W).
  return yield* base.InitializeBinding(V.ReferencedName as JSStringValue, W);
}

/** https://tc39.es/ecma262/#sec-makeprivatereference */
export function MakePrivateReference(baseValue: Value, privateIdentifier: JSStringValue) {
  // 1. Let privEnv be the running execution context's PrivateEnvironment.
  const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 2. Assert: privEnv is not null.
  // but we allow private reference to be accessed directly in the inspector eval
  if (privEnv === null) {
    const scriptId = getActiveScriptId();
    const script = surroundingAgent.parsedSources.get(scriptId!);
    if (script instanceof DynamicParsedCodeRecord && script?.HostDefined?.isInspectorEval) {
      let privateName;
      if (baseValue instanceof ObjectValue) {
        privateName = baseValue.PrivateElements.find((elem) => elem.Key.Description.stringValue() === privateIdentifier.stringValue())?.Key;
      }
      privateName ??= new PrivateName(privateIdentifier);
      return new ReferenceRecord({
        Base: baseValue,
        ReferencedName: privateName,
        Strict: Value.true,
        ThisValue: undefined,
      });
    } else {
      Assert(privEnv !== null);
    }
  }
  // 3. Let privateName be ! ResolvePrivateIdentifier(privEnv, privateIdentifier).
  const privateName = ResolvePrivateIdentifier(privEnv!, privateIdentifier);
  // 4. Return the Reference Record { [[Base]]: baseValue, [[ReferencedName]]: privateName, [[Strict]]: true, [[ThisValue]]: empty }.
  return new ReferenceRecord({
    Base: baseValue,
    ReferencedName: privateName,
    Strict: Value.true,
    ThisValue: undefined,
  });
}


/**
 * proposal-runtime-types (references extension): a reference value decays to
 * the current value of the storage location it borrows at any boundary that
 * consumes a value, which is what gives a reference no observable identity. A
 * non-reference value passes through unchanged.
 */
export function* DecayReferenceValue(value: Value): ValueEvaluator {
  if (value instanceof ReferenceValue) {
    return Q(yield* GetValue(value.Location));
  }
  return value;
}
