import { Value, ObjectValue } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { builtinTypeRecord, setRangeEnumRecordImpl } from '../type-system/records.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import {
  X, CreateDataPropertyOrThrow, Descriptor, surroundingAgent, type Realm,
} from '#self';

/**
 * proposal-runtime-types (ranges.md "Types", #sec-ranges): `Bound` and
 * `Interval`.
 *
 * `sec-ranges` names both: "_S_ and _E_ are values of `Bound`, either
 * `Bound.Closed` or `Bound.Open`", and "The four-way name of a pair is an
 * `Interval`, which a range exposes and a diagnostic prefers over the
 * parameterization". Until this file neither name was bound and `interval`
 * answered with a string, which is most of what the four-way name is for: a
 * string cannot be switched over exhaustively and carries no narrowing, and
 * exhaustiveness over the four intervals is the reason a range exposes a single
 * name rather than the two bounds it derives it from.
 *
 * Both are ordinary ENUMS - nominal types over a sentinel declaration, carrying
 * their members and an underlying type - built the way the metadata interface
 * names are built, so that everything an enum declared in source gets (member
 * data properties, SameValue membership, the subtype relation to the underlying
 * type) they get too, without a declaration having to appear in every realm.
 *
 * `uint8` underlies both, as ranges.md declares: `enum Bound: uint8` and
 * `enum Interval: uint8`.
 */

export const boundMemberNames = ['Closed', 'Open'] as const;

export const intervalMemberNames = ['Closed', 'ClosedOpen', 'OpenClosed', 'Open'] as const;

/**
 * One sentinel per enum, module-level so identity is stable: a fresh sentinel
 * per call would make every mention of `Bound` a different type, which is the
 * same reason the metadata interface names hold theirs at module level.
 */
const sentinels = new Map<string, ParseNode>([
  ['Bound', { type: 'RangeEnum', name: 'Bound' } as unknown as ParseNode],
  ['Interval', { type: 'RangeEnum', name: 'Interval' } as unknown as ParseNode],
]);

function enumRecord(name: 'Bound' | 'Interval', members: readonly string[]): TypeRecord {
  const declaration = sentinels.get(name)!;
  return {
    Kind: 'nominal',
    Declaration: declaration,
    Arguments: [],
    LibraryName: name,
    // The members are the ordinals, as an enum with no initializers takes them:
    // `Bound.Closed` is 0 and `Bound.Open` is 1.
    EnumMembers: members.map((_, i) => Value(i)),
    Underlying: builtinTypeRecord('uint8') ?? undefined,
  } as TypeRecord;
}

export function boundRecord(): TypeRecord {
  return enumRecord('Bound', boundMemberNames);
}

export function intervalRecord(): TypeRecord {
  return enumRecord('Interval', intervalMemberNames);
}

/** The value of one member, which is its ordinal. */
export function boundValue(name: (typeof boundMemberNames)[number]): Value {
  return Value(boundMemberNames.indexOf(name));
}

export function intervalValue(name: (typeof intervalMemberNames)[number]): Value {
  return Value(intervalMemberNames.indexOf(name));
}

/**
 * Bind `Bound` and `Interval` on the global object, each a type name whose Type
 * Object carries its members as data properties - the shape an `EnumDeclaration`
 * produces, so `Bound.Open` reads and `x is Bound` tests membership.
 *
 * They are also reachable as `Range.Bound` and `Range.Interval`, which is how
 * ranges.md writes them ("Exposed as Range.Bound"), so a program may name either.
 */
export function bindRangeEnumGlobals(realmRec: Realm): void {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const global = realmRec.GlobalObject;
  const rangeGlobal = X(global.GetOwnProperty(Value('Range')));
  for (const [name, members, record] of [
    ['Bound', boundMemberNames, boundRecord()],
    ['Interval', intervalMemberNames, intervalRecord()],
  ] as const) {
    const obj = GetTypeObject(record, realmRec);
    members.forEach((member, i) => {
      X(CreateDataPropertyOrThrow(obj, Value(member), Value(i)));
    });
    // Bound ONLY on `Range`, which is what ranges.md says: "Exposed as
    // Range.Bound". A bare global would squat two very common identifiers -
    // temporal.md declares its own `type Interval = { start, end }`, and binding
    // `Interval` globally took that name away from it. The qualified form is
    // also how the design writes them everywhere outside its own declarations.
    if (rangeGlobal !== undefined && rangeGlobal !== Value.undefined && 'Value' in rangeGlobal
        && rangeGlobal.Value instanceof ObjectValue) {
      X(rangeGlobal.Value.DefineOwnProperty(Value(name), Descriptor({
        Value: obj,
        Writable: Value.false,
        Enumerable: Value.false,
        Configurable: Value.true,
      })));
    }
  }
}

// Registered once at module load, so `Bound` and `Interval` in TYPE position
// resolve to these enum records rather than to bare library nominals.
setRangeEnumRecordImpl((name) => (name === 'Bound' ? boundRecord() : intervalRecord()));
