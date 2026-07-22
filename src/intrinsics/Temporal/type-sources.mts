import { Value, ObjectValue } from '../../value.mts';
import { X } from '../../completion.mts';
import type { ParseNode } from '../../parser/ParseNode.mts';
import type { TypeRecord } from '../../type-system/records.mts';
import { GetTypeObject } from '../../type-system/intern.mts';
import { AssociateClassType } from '../../abstract-ops/runtime-types.mts';
import { CreateDataPropertyOrThrow, type Realm } from '#self';

/**
 * proposal-runtime-types (temporal.md): Temporal's classes and enums become
 * types. This registers them once per realm, when both the runtime-types and
 * temporal features are on.
 *
 * A built-in Temporal type has no source declaration, so it takes its identity
 * from a [[LibraryName]] (as the other library nominals do) and stands its
 * [[Declaration]] slot on a shared sentinel Parse Node. The nominal shape
 * requires a [[Declaration]], but a Temporal type is told apart by its
 * [[LibraryName]], never by this node, so one sentinel for all of them suffices.
 */
const temporalDeclarationSentinel = { type: 'LibraryType', location: { startIndex: -1 } } as unknown as ParseNode;

// The Temporal classes whose instances a typed field or annotation can hold.
// Each becomes a nominal class type whose members are the instances whose
// prototype chain reaches its constructor.
const TEMPORAL_CLASSES = [
  'Instant', 'Duration', 'PlainDate', 'PlainTime', 'PlainDateTime',
  'ZonedDateTime', 'PlainYearMonth', 'PlainMonthDay',
] as const;

// Temporal.Unit, the string enum every unit-taking API accepts. Declaration
// order is significant: the design orders a string-underlying enum by it, which
// is what the (deferred) dimensioned overloads rely on.
const TEMPORAL_UNITS: readonly (readonly [string, string])[] = [
  ['Nanosecond', 'nanosecond'], ['Microsecond', 'microsecond'], ['Millisecond', 'millisecond'],
  ['Second', 'second'], ['Minute', 'minute'], ['Hour', 'hour'],
  ['Day', 'day'], ['Week', 'week'], ['Month', 'month'], ['Year', 'year'],
];

export function RegisterTemporalTypeSources(realmRec: Realm): void {
  const intrinsics = realmRec.Intrinsics as unknown as Record<string, Value | undefined>;

  for (const name of TEMPORAL_CLASSES) {
    const ctor = intrinsics[`%Temporal.${name}%`];
    if (!(ctor instanceof ObjectValue)) {
      continue;
    }
    const record: TypeRecord = {
      Kind: 'nominal',
      Declaration: temporalDeclarationSentinel,
      Arguments: [],
      Constructor: ctor,
      LibraryName: `Temporal.${name}`,
    };
    AssociateClassType(ctor, GetTypeObject(record, realmRec));
  }

  // Temporal.Unit is an enum value on the Temporal object: its members are data
  // properties of the enum's Type Object, and membership is SameValue against the
  // member values, so a misspelled unit string is a type error rather than a
  // RangeError deep in a call.
  const temporalObject = intrinsics['%Temporal%'];
  if (temporalObject instanceof ObjectValue) {
    const memberValues = TEMPORAL_UNITS.map(([, v]) => Value(v));
    const unitType = GetTypeObject({
      Kind: 'nominal',
      Declaration: temporalDeclarationSentinel,
      Arguments: [],
      EnumMembers: memberValues,
      LibraryName: 'Temporal.Unit',
    }, realmRec) as ObjectValue;
    for (let i = 0; i < TEMPORAL_UNITS.length; i += 1) {
      X(CreateDataPropertyOrThrow(unitType, Value(TEMPORAL_UNITS[i][0]), memberValues[i]));
    }
    X(CreateDataPropertyOrThrow(temporalObject, Value('Unit'), unitType));
  }
}
