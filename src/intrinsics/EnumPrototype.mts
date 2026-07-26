import { Descriptor, Value, wellKnownSymbols, type Arguments, type FunctionCallContext } from '../value.mts';
import { Q, X, type ValueCompletion } from '../completion.mts';
import type { TypeObject } from '../type-system/intern.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { SameValue, Throw, CreateArrayFromList, CreateArrayIterator } from '#self';
import type { Realm } from '#self';

/**
 * proposal-runtime-types (README "Enums"): enumeration objects share a common
 * prototype, %Enum.prototype%, with a reserved set of functions. The design
 * lists seven; `forEach`, `filter`, and `map` are DECLINED as compositions -
 * `entries()` composes with the Array methods to give all three, and this
 * proposal has declined composable surface before (the `never`-in-union
 * canonicalization, the rational conversions). The five here are the normative
 * set the author approved.
 *
 * The enumerator NAMES are read from the declaration rather than carried on the
 * Type Record. The record already holds [[EnumMembers]], the values, and the
 * declaration is the enum's identity, so its member list is the one place the
 * names exist and cannot fall out of step with them.
 */
function enumEntriesOf(O: Value): { names: readonly string[], values: readonly Value[] } | null {
  const record = (O as TypeObject).TypeRecord;
  if (!record || record.Kind !== 'nominal' || record.EnumMembers === undefined) {
    return null;
  }
  const declaration = record.Declaration as { EnumMemberList?: readonly { IdentifierName?: { name?: string } }[] } | undefined;
  const list = declaration?.EnumMemberList;
  const names: string[] = [];
  for (let i = 0; i < record.EnumMembers.length; i += 1) {
    const name = list?.[i]?.IdentifierName?.name;
    if (typeof name !== 'string') {
      // A record built without a declaration (an intrinsic enum source) has
      // values and no names. Answering a positional string would invent one.
      return null;
    }
    names.push(name);
  }
  return { names, values: record.EnumMembers };
}

function requireEnum(thisValue: Value, method: string) {
  const entries = enumEntriesOf(thisValue);
  if (entries === null) {
    return Throw.TypeError('$1 called on incompatible receiver $2', `Enum.prototype.${method}`, thisValue);
  }
  return entries;
}

/**
 * `Count.toString(Count.Zero)` is `'Zero'`: toString maps a VALUE to its key.
 * It answered `"[object Type]"` - the inherited Object.prototype.toString -
 * which is a silently wrong answer where the design specifies a right one, and
 * by this project's standard that is worse than a missing feature (F48).
 *
 * It takes the value as an ARGUMENT rather than reading a receiver, which is
 * the design's own signature and is what makes it a lookup on the enumeration
 * rather than a method on an enumerator: an enumerator is a value of the
 * underlying type and has no method of its own to call.
 */
/** https://sirisian.github.io/ecmascript-types/#sec-enums */
function EnumProto_toString([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const entries = requireEnum(thisValue, 'toString');
  if (!('names' in entries)) {
    return entries;
  }
  for (let i = 0; i < entries.values.length; i += 1) {
    if (SameValue(value, entries.values[i]!)) {
      return Value(entries.names[i]!);
    }
  }
  // A value that is not an enumerator has no key. The design says toString
  // maps a value to its key and says nothing of a value that has none;
  // *undefined* is the answer that does not invent a name.
  return Value.undefined;
}

/** The string keys, in declaration order. */
/** https://sirisian.github.io/ecmascript-types/#sec-enums */
function EnumProto_keys(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const entries = requireEnum(thisValue, 'keys');
  if (!('names' in entries)) {
    return entries;
  }
  const keyValues: Value[] = [];
  for (const n of entries.names) {
    keyValues.push(Value(n));
  }
  const array = X(CreateArrayFromList(keyValues));
  return Q(CreateArrayIterator(array, 'value'));
}

/** The values, in declaration order. */
/** https://sirisian.github.io/ecmascript-types/#sec-enums */
function EnumProto_values(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const entries = requireEnum(thisValue, 'values');
  if (!('names' in entries)) {
    return entries;
  }
  const array = X(CreateArrayFromList([...entries.values]));
  return Q(CreateArrayIterator(array, 'value'));
}

/** [key, value] pairs, in declaration order. */
/** https://sirisian.github.io/ecmascript-types/#sec-enums */
function EnumProto_entries(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  const entries = requireEnum(thisValue, 'entries');
  if (!('names' in entries)) {
    return entries;
  }
  const pairs: Value[] = [];
  for (let i = 0; i < entries.names.length; i += 1) {
    pairs.push(X(CreateArrayFromList([Value(entries.names[i]!), entries.values[i]!])));
  }
  const array = X(CreateArrayFromList(pairs));
  return Q(CreateArrayIterator(array, 'value'));
}

export function bootstrapEnumPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['toString', EnumProto_toString, 1],
    ['keys', EnumProto_keys, 0],
    ['values', EnumProto_values, 0],
    ['entries', EnumProto_entries, 0],
  ], realmRec.Intrinsics['%Type.prototype%'], 'Enum');
  // @@iterator is `entries`, not `values`: iterating an ENUMERATION yields what
  // the enumeration is, which is a set of named values, and a bare value loses
  // the name that distinguishes an enum from its underlying type. It is the
  // same choice Map makes and the opposite of the one Array and Set make, for
  // the same reason - what the collection holds is pairs.
  const entriesFn = X(proto.GetOwnProperty(Value('entries')));
  X(proto.DefineOwnProperty(wellKnownSymbols.iterator, Descriptor({
    Value: (entriesFn as Descriptor).Value,
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.true,
  })));
  realmRec.Intrinsics['%Enum.prototype%'] = proto;
}
