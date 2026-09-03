import type { ParseNode } from '../parser/ParseNode.mts';
import { SoAGather, SoAScatter, SoAElementBackingOf } from '../intrinsics/SoA.mts';
import { isValueParameterBinding, lookupTypeParameter, ValuePackView } from '../type-system/runtime.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import {
  ReferenceRecord,
  Value,
  PrivateName,
  JSStringValue,
  ObjectValue,
  ReferenceValue,
  ReferenceRunValue,
  NumberValue,
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
/** F-T: set by the rest binding while it initializes its own run binding. */
let initializingReferenceRun = false;
export function* withReferenceRunInitializationEvaluator<T>(f: () => PlainEvaluator<T>): PlainEvaluator<T> {
  initializingReferenceRun = true;
  try {
    return yield* f();
  } finally {
    initializingReferenceRun = false;
  }
}

/**
 * F-T: the element of a ref RUN a property reference names - the k-th location
 * for a constant index, `length` for the count; anything else is the escape.
 */
function* referenceRunElement(run: ReferenceRunValue, key: Value): PlainEvaluator<ReferenceRecord | 'length'> {
  if (key instanceof JSStringValue && key.stringValue() === 'length') {
    return 'length';
  }
  const index = key instanceof JSStringValue ? Number(key.stringValue()) : (key instanceof NumberValue ? key.numberValue() : NaN);
  if (Number.isInteger(index) && index >= 0 && index < run.Locations.length) {
    return run.Locations[index]!;
  }
  return Throw.TypeError('$1', Value('a ref rest binds no array: index it with a constant in range, read its length, or forward it with `...`'));
}

export function* GetValue(V: ReferenceRecord | Value): PlainEvaluator<Value> {
  // F-T: `refs[k]` and `refs.length` on a ref run read through the location.
  if (V instanceof ReferenceRecord && V.Base instanceof ReferenceRunValue) {
    const element = Q(yield* referenceRunElement(V.Base, V.ReferencedName as Value));
    if (element === 'length') {
      return Value(V.Base.Locations.length);
    }
    return Q(yield* GetValue(element));
  }
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
        // #sec-generics: a VALUE generic parameter is bound to the literal type
        // of its argument, "with the value recoverable as that type's one
        // value". A body that reads it where a value is required - the design's
        // `y * W + x` - reads that value; one that reads it where a type is
        // required reads the type, which the value still carries, since the
        // literal type's single value IS its view of the binding. Handing back
        // the Type Object for a value parameter made arithmetic over it NaN.
        // F165. The test is the DECLARATION, not the bound record's kind:
        // sec-generic-parameters-as-values gives a value parameter its value
        // here and a type parameter its Type Object, and a type parameter given
        // a literal argument is bound to a literal record too. Asking the
        // record made `f.<L>()` with `type L = 'abc'` hand back the string.
        if (bound.Kind === 'literal' && !isValueParameterBinding(bound)) {
          (globalThis as { __unmarked?: Set<string> }).__unmarked?.add((V.ReferencedName as JSStringValue).stringValue());
        }
        if (bound.Kind === 'literal' && isValueParameterBinding(bound)) {
          return bound.Value;
        }
        // #sec-variadic-parameters (Phase 4): a VALUE pack reads as a frozen
        // fixed-extent array of its literal elements' values, one per
        // specialization - the same array on every read, so `I === I` - which
        // is what makes `I.length` and `I[k]` constants a `where` can test.
        if (bound.Kind === 'tuple' && isValueParameterBinding(bound)) {
          return Q(yield* ValuePackView(bound));
        }
        return GetTypeObject(bound);
      }
    }
    return Throw.ReferenceError('$1 is not defined', V.ReferencedName);
  }
  // proposal-runtime-types #sec-soa-references: dereferencing a borrow of an
  // SoA element yields the element VIEW, a live handle whose field reads and
  // writes go to the columns at this index. This is a DEREFERENCE and not a
  // decay: it preserves the aliasing, which is what makes `p.x = 1` through a
  // `ref` write into the container.
  const arrayBorrowFailure = RequireArrayBorrowLive(V);
  if (arrayBorrowFailure !== undefined) {
    return arrayBorrowFailure;
  }
  if (V.SoAElement !== undefined) {
    return V.SoAElement;
  }
  // 3. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V) === Value.true) {
    __ts_cast__<PropertyReference>(V);
    // proposal-runtime-types (spec sec-class-operators): a computed index access
    // whose base declares an index operator reads through the operator, called
    // with the index as its argument, rather than through the ordinary [[Get]].
    if (V.IndexOperator !== undefined) {
      // #sec-class-operators: the accessor receives every index the access
      // supplied, which for a single-index access is a list of one.
      const operatorResult = Q(yield* Call(V.IndexOperator, V.Base as Value, (V.IndexArguments ?? [V.ReferencedName as Value]) as Value[]));
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

/**
 * proposal-runtime-types #sec-location-consuming-contexts: the location an
 * assignment target denotes. A call in a location-consuming position keeps the
 * borrow it returned, so evaluating such a target yields a Reference Value;
 * every position that goes on to store through a target passes it through here
 * first, and everything else is returned unchanged.
 *
 * The unwrap belongs at the TARGET rather than inside GetValue, because a
 * `return ref e` evaluates through GetValue too - dereferencing there would
 * take the referent's value and the borrow would never leave the callee.
 */
export function LocationOfAssignmentTarget(node: ParseNode, target: ReferenceRecord | Value) {
  if (target instanceof ReferenceValue) {
    return target.Location;
  }
  // A call the parser admitted as a target that did not in fact return a borrow
  // has no location to store into. Where the callee's return type is known the
  // type system refuses the form before the source runs; where it is not, that
  // check is deferred to here, and this is what it throws - a TypeError, as for
  // the other location-consuming contexts, rather than the ReferenceError the
  // base language raises for a target that is not a reference at all.
  if (node.type === 'CallExpression' && (node as ParseNode.CallExpression).LocationConsuming === true) {
    return Throw.TypeError('this call did not return a ref, so there is no location to assign to');
  }
  return target;
}

/** https://tc39.es/ecma262/#sec-putvalue */
export function* PutValue(V: ReferenceRecord | Value, W: Value): PlainEvaluator {
  // F-T: a write through `refs[k]` reaches the k-th location; the run itself
  // is never stored (the escape error a single ref parameter has).
  if (W instanceof ReferenceRunValue) {
    return Throw.TypeError('$1', Value('a ref rest binds no array: forward it with `...`, or index it with a constant'));
  }
  if (V instanceof ReferenceRecord && V.Base instanceof ReferenceRunValue) {
    const element = Q(yield* referenceRunElement(V.Base, V.ReferencedName as Value));
    if (element === 'length') {
      return Throw.TypeError('$1', Value('the length of a ref rest is a constant'));
    }
    return Q(yield* PutValue(element, W));
  }
  // proposal-runtime-types #sec-location-consuming-contexts: an assignment
  // whose target is a call stores THROUGH the location the call returned; the
  // borrow arrives here in place of a Reference Record.
  if (V instanceof ReferenceValue) {
    return Q(yield* PutValue(V.Location, W));
  }
  // proposal-runtime-types #sec-soa-references: a whole-element store through a
  // borrow of an SoA element writes every column at that index, which is what
  // `p = value` means for an element whose fields are spread across columns.
  if (V instanceof ReferenceRecord) {
    const stale = RequireArrayBorrowLive(V);
    if (stale !== undefined) {
      return stale;
    }
  }
  if (V instanceof ReferenceRecord && V.SoAElement !== undefined) {
    const backing = SoAElementBackingOf(V.SoAElement as unknown as object)!;
    Q(yield* SoAScatter(backing.Storage, backing.Index, W));
    return undefined;
  }
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
    // The write direction takes the indices and then the value, the shape the
    // design writes as `set operator[](...args, value)`.
    Q(yield* Call(V.IndexSetOperator, V.Base as Value, [...(V.IndexArguments ?? [V.ReferencedName as Value]), W] as Value[]));
    return undefined;
  }
  // proposal-runtime-types #sec-class-operators: where the class declares only
  // a read direction and that direction returns a BORROW, the borrow is the
  // location and the write stores through it - the design's `get operator[]() {
  // return ref this[...]; }`, which is written without a setter because a
  // reference already denotes the place a write goes.
  //
  // This is the assignment-target rule of #sec-location-consuming-contexts
  // applied to an index access: the accessor is a call whose result is a
  // reference, and an assignment whose target is such a call stores through it.
  if (V.IndexOperator !== undefined) {
    // A read-modify-write applies the accessor once per direction, as it does
    // for a declared getter/setter pair: the read yields the value and the
    // write asks for the location again. Collapsing the two would mean the
    // reference carrying the borrow the read produced.
    const borrow = Q(yield* Call(V.IndexOperator, V.Base as Value, (V.IndexArguments ?? [V.ReferencedName as Value]) as Value[]));
    if (borrow instanceof ReferenceValue) {
      return Q(yield* PutValue(borrow.Location, W));
    }
    // A read direction that yields a value has no location for the write to
    // reach, so the write would not be read back and is reported instead.
    return Throw.TypeError('this index accessor has no set operator[], so the write would not be read back');
  }
  // 5. If IsPropertyReference(V) is true, then
  if (IsPropertyReference(V) === Value.true) {
    // proposal-runtime-types #sec-vector-lanes: a lane write, answered before
    // ToObject for the reason the read is - a vector is a primitive and boxing
    // it loses the lanes. The clause admits this and records that whether it
    // should be admitted at all is settled there: `withLane` was thought to make
    // it redundant and does not, since withLane's index is a compile-time
    // constant and this one's is not.
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
  // F-T: a ref run is never stored - `const saved = refs` is the escape a
  // reference never survives - but a ref REST's own binding holds it.
  if (W instanceof ReferenceRunValue && !(V instanceof ReferenceRecord && initializingReferenceRun)) {
    return Throw.TypeError('$1', Value('a ref rest binds no array: forward it with `...`, or index it with a constant'));
  }
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
/**
 * proposal-runtime-types #sec-reference-liveness: a borrow of an element of a
 * growable `[].<T>` is invalidated when the backing allocation is relocated by
 * growth. The generation recorded when the borrow was taken is compared here,
 * at the USE, which is where the relocation rule applies for storage that can
 * move - a length comparison would not see a `reserve`, and a relocation test
 * sees exactly the event that invalidates.
 */
export function RequireArrayBorrowLive(V: ReferenceRecord) {
  const borrow = V.ArrayBorrow;
  if (borrow === undefined) {
    return undefined;
  }
  const current = (borrow.Source as unknown as { TypedGeneration?: number }).TypedGeneration ?? 0;
  if (current !== borrow.TakenAt) {
    return Throw.TypeError('this reference is into an array that has since grown');
  }
  return undefined;
}

export function* DecayReferenceValue(value: Value): ValueEvaluator {
  if (value instanceof ReferenceValue) {
    // An SoA element decays to the GATHERED value, the copy `s[i]` produces,
    // and not to the live view a dereference yields. Decay is where a borrow
    // stops being a borrow, so what it produces must be a value with no tie to
    // the container; handing back the view would let aliasing survive a
    // boundary that consumes a value.
    const soaElement = value.Location.SoAElement;
    if (soaElement !== undefined) {
      const backing = SoAElementBackingOf(soaElement as unknown as object)!;
      return Q(yield* SoAGather(backing.Storage, backing.Index));
    }
    return Q(yield* GetValue(value.Location));
  }
  return value;
}

/**
 * proposal-runtime-types #sec-soa-references: dereference a reference value for
 * an ACCESS rather than for a value. The two coincide for an ordinary borrow,
 * whose referent is just the value at its location, and diverge for a borrow of
 * an SoA element: an access must reach the live element, so that the base of
 * `p.x = 1` is the view and the write lands in the column, while a decay must
 * produce a detached copy. Positions that go on to read or write THROUGH the
 * result use this; positions that consume a value use DecayReferenceValue.
 */
export function* DereferenceReferenceValue(value: Value): ValueEvaluator {
  if (value instanceof ReferenceValue) {
    return Q(yield* GetValue(value.Location));
  }
  return value;
}
