import { Q, X, type ValueEvaluator } from '../completion.mts';
import {
  BigIntValue, BooleanValue, JSStringValue, NullValue, NumberValue, ObjectValue,
  SymbolValue, TypedNumberValue, UndefinedValue, Value, Descriptor, type Arguments,
} from '../value.mts';
import { CopyValueClassInstance } from '../abstract-ops/testing-comparison.mts';
import {
  CreateBuiltinFunction, OrdinaryObjectCreate, CreateDataPropertyOrThrow,
  LengthOfArrayLike, Get, IsArray, Call, Construct, Realm, surroundingAgent, Throw,
} from '#self';

/**
 * `structuredClone(value)` - a deep copy by value.
 *
 * PLAN-remaining-blockers.md item 6. Defined by HTML rather than by ECMAScript,
 * and implemented here because the proposal states a type for it
 * (`standardlibrary.md`: `function structuredClone<T>(value: T): T`) and a
 * signature is a claim that the function EXISTS. A type system that cannot say
 * what a structured clone returns has a hole where its users are - moving a
 * typed value across a boundary is the thing the identity signature is for.
 *
 * SCOPED to the ECMAScript-shaped subset. HTML's StructuredSerialize covers
 * transferables, `SharedArrayBuffer`, `ImageData` and more that mean nothing in
 * a bare engine; what is here is what a program can build out of this
 * specification: primitives, `Array`, plain objects, `Map`, `Set`, `Date`,
 * `RegExp`, `Error`, and the proposal's own typed values.
 *
 * A FUNCTION and a SYMBOL are not cloneable and are REFUSED. HTML raises a
 * *DataCloneError*, which is a DOM exception this engine does not define, so a
 * *TypeError* is raised instead: refusing with an error a program can catch is
 * the behaviour that matters, and inventing a DOM exception hierarchy to carry
 * one name would be a larger change than this signature is worth. An embedder
 * that has `DOMException` should raise the specified error.
 */
function* StructuredClone([value = Value.undefined]: Arguments): ValueEvaluator {
  const memo = new Map<ObjectValue, Value>();
  return Q(yield* cloneValue(value, memo));
}

function* cloneValue(value: Value, memo: Map<ObjectValue, Value>): ValueEvaluator {
  // A primitive is its own clone: it has no identity to duplicate. A
  // TypedNumberValue is one of these - the proposal's numeric value types carry
  // their type in the value, so cloning one needs nothing.
  if (value instanceof UndefinedValue || value instanceof NullValue
      || value instanceof BooleanValue || value instanceof NumberValue
      || value instanceof BigIntValue || value instanceof JSStringValue
      || value instanceof TypedNumberValue) {
    return value;
  }
  // #sec-value-types: a SYMBOL has identity and no serialization, so HTML
  // refuses it. So does a function, whose body cannot be carried across.
  if (value instanceof SymbolValue) {
    return Throw('TypeError', 'Raw', 'A symbol cannot be cloned');
  }
  if (!(value instanceof ObjectValue)) {
    return value;
  }
  if ('Call' in value) {
    return Throw('TypeError', 'Raw', 'A function cannot be cloned');
  }
  // The MEMO is what makes a cycle terminate and what preserves sharing: two
  // references to one object in the source are two references to one object in
  // the clone, which a naive recursion loses along with its termination.
  const seen = memo.get(value);
  if (seen !== undefined) {
    return seen;
  }

  // A VALUE TYPE CLASS instance clones by the copy #sec-value-type-copying
  // already defines, which carries its type, its private state and its sealing.
  // Doing it any other way here would give a structured clone different
  // semantics from an assignment, for one kind of value, for no reason.
  const asValueClass = CopyValueClassInstance(value);
  if (asValueClass !== value) {
    memo.set(value, asValueClass);
    return asValueClass;
  }

  const realm = surroundingAgent.currentRealmRecord;

  if (X(IsArray(value)) === Value.true) {
    const length = Q(yield* LengthOfArrayLike(value));
    const target = X(ArrayCreateFor(length));
    memo.set(value, target);
    for (let i = 0; i < length; i += 1) {
      const key = Value(String(i));
      const element = Q(yield* Get(value, key));
      X(CreateDataPropertyOrThrow(target, key, Q(yield* cloneValue(element, memo))));
    }
    return target;
  }

  if ('MapData' in value) {
    const target = Q(yield* ConstructEmpty('%Map%'));
    memo.set(value, target);
    const setter = Q(yield* Get(target, Value('set')));
    for (const entry of (value as unknown as { MapData: { Key: Value | undefined, Value: Value | undefined }[] }).MapData) {
      if (entry.Key === undefined) {
        continue;
      }
      Q(yield* Call(setter, target, [
        Q(yield* cloneValue(entry.Key, memo)),
        Q(yield* cloneValue(entry.Value ?? Value.undefined, memo)),
      ]));
    }
    return target;
  }

  if ('SetData' in value) {
    const target = Q(yield* ConstructEmpty('%Set%'));
    memo.set(value, target);
    const adder = Q(yield* Get(target, Value('add')));
    for (const element of (value as unknown as { SetData: (Value | undefined)[] }).SetData) {
      if (element === undefined) {
        continue;
      }
      Q(yield* Call(adder, target, [Q(yield* cloneValue(element, memo))]));
    }
    return target;
  }

  // A PLAIN OBJECT, and anything else this subset does not know: its own
  // enumerable String-keyed properties are cloned onto a fresh ordinary object.
  // The PROTOTYPE is deliberately not carried - HTML's algorithm produces a
  // plain object for one, and carrying a class's prototype without running its
  // constructor would produce an instance that never was constructed.
  const target = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%'], []);
  memo.set(value, target);
  for (const key of X(value.OwnPropertyKeys())) {
    if (!(key instanceof JSStringValue)) {
      continue;
    }
    const desc = Q(yield* value.GetOwnProperty(key));
    if (desc instanceof UndefinedValue || desc.Enumerable !== Value.true) {
      continue;
    }
    const property = Q(yield* Get(value, key));
    X(CreateDataPropertyOrThrow(target, key, Q(yield* cloneValue(property, memo))));
  }
  return target;
}

function ArrayCreateFor(length: number) {
  const realm = surroundingAgent.currentRealmRecord;
  const array = OrdinaryObjectCreate(realm.Intrinsics['%Array.prototype%'], []);
  X(array.DefineOwnProperty(Value('length'), Descriptor({
    Value: Value(length), Writable: Value.true, Enumerable: Value.false, Configurable: Value.false,
  })));
  return array;
}

function* ConstructEmpty(intrinsic: '%Map%' | '%Set%'): ValueEvaluator {
  const constructor = surroundingAgent.currentRealmRecord.Intrinsics[intrinsic];
  return Q(yield* Construct(constructor as ObjectValue, []));
}

export function bootstrapStructuredClone(realmRec: Realm) {
  realmRec.Intrinsics['%structuredClone%'] = CreateBuiltinFunction(
    StructuredClone, 1, Value('structuredClone'), [], realmRec,
  );
}
