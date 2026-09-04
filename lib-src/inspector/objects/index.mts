import type { Protocol } from 'devtools-protocol';
import type { InspectorContext } from '../context.mts';
import {
  Null, Undefined, Boolean, Number, String, Symbol, TypedNumber, UnknownPrimitive, Vector,
} from './primitives.mts';
import { Function } from './function.mts';
import {
  DefaultObject, InternalInspectorEntry,
} from './objects.mts';
import { ShadowRealm } from './shadow-realms.mts';
import { Module } from './modules.mts';
import { RegExp } from './RegExp.mts';
import { Type } from './Type.mts';
import { Proxy } from './proxies.mts';
import { Promise } from './promises.mts';
import {
  Array, TypedArray, ArrayBuffer, DataView,
} from './arrays.mts';
import {
  Date, TemporalDuration, TemporalInstant, TemporalPlainDate, TemporalPlainDateTime, TemporalPlainMonthDay, TemporalPlainTime, TemporalPlainYearMonth, TemporalZonedDateTime,
} from './dates.mts';
import {
  Map, Set, WeakMap, WeakSet,
} from './collections.mts';
import { Error } from './errors.mts';
import {
  BigIntValue,
  isArrayBufferObject,
  isArrayExoticObject,
  IsCallable,
  isDataViewObject,
  isDateObject,
  isErrorObject,
  isMapObject,
  isModuleNamespaceObject,
  isPromiseObject,
  isProxyExoticObject,
  isRegExpObject,
  isSetObject,
  isShadowRealmObject,
  isTemporalDurationObject,
  isTemporalInstantObject,
  isTemporalPlainDateObject,
  isTemporalPlainDateTimeObject,
  isTemporalPlainMonthDayObject,
  isTemporalPlainTimeObject,
  isTemporalPlainYearMonthObject,
  isTemporalZonedDateTimeObject,
  isTypedArrayObject,
  isWeakMapObject,
  isWeakSetObject,
  JSStringValue,
  NumberValue,
  ObjectValue, SymbolValue, TypedNumberValue, Value, VectorValue, isTypeObject,
} from '#self';

export interface Inspector<T extends Value> {
  toRemoteObject(value: T, getObjectId: (val: SymbolValue | ObjectValue) => string, context: InspectorContext, generatePreview: boolean | undefined): Protocol.Runtime.RemoteObject;
  toObjectPreview(value: T, context: InspectorContext): Protocol.Runtime.ObjectPreview;
  toPropertyPreview(name: string, value: T, context: InspectorContext): Protocol.Runtime.PropertyPreview;
  toDescription(value: T, context: InspectorContext): string;
  toInternalProperties?(value: T, getObjectId: (val: SymbolValue | ObjectValue) => string, context: InspectorContext, generatePreview: boolean | undefined): Protocol.Runtime.InternalPropertyDescriptor[];
  exoticProperties?(value: T, getObjectId: (val: SymbolValue | ObjectValue) => string, context: InspectorContext, generatePreview: boolean | undefined): Protocol.Runtime.PropertyDescriptor[];
}

export function getInspector(value: Value): Inspector<Value> {
  switch (true) {
    case value === Value.null:
      return Null;
    case value === Value.undefined:
      return Undefined;
    case value === Value.true || value === Value.false:
      return Boolean;
    case value instanceof SymbolValue:
      return Symbol;
    case value instanceof JSStringValue:
      return String;
    case value instanceof NumberValue:
    case value instanceof BigIntValue:
      return Number;
    // proposal-runtime-types: the extension's own primitive value classes. A
    // typed number is NOT a NumberValue subclass and a vector is not a
    // primitive the base language knows, so without these they matched no case
    // above and fell through to the object branch below - where reading an
    // internal slot list off a primitive threw and took the inspector with it.
    // A typed string needs no case: it is a transparent JSStringValue subclass
    // and is caught above.
    case value instanceof TypedNumberValue:
      return TypedNumber;
    case value instanceof VectorValue:
      return Vector;
    case isProxyExoticObject(value):
      return Proxy;
    // ABOVE the callable case: a Type
    // Object is callable (its construction boundary), so it would otherwise
    // match there and render as a native function.
    case isTypeObject(value):
      return Type;
    case IsCallable(value):
      return Function;
    case isArrayExoticObject(value):
      return Array;
    case isRegExpObject(value):
      return RegExp;
    case isDateObject(value):
      return Date;
    case isMapObject(value):
      return Map;
    case isSetObject(value):
      return Set;
    case isWeakMapObject(value):
      return WeakMap;
    case isWeakSetObject(value):
      return WeakSet;
    // generator
    case isErrorObject(value):
      return Error;
    case isPromiseObject(value):
      return Promise;
    case isTypedArrayObject(value):
      return TypedArray;
    case isArrayBufferObject(value):
      return ArrayBuffer;
    case isDataViewObject(value):
      return DataView;
    case isModuleNamespaceObject(value):
      return Module;
    case isShadowRealmObject(value):
      return ShadowRealm;
    case isTemporalInstantObject(value):
      return TemporalInstant;
    case isTemporalDurationObject(value):
      return TemporalDuration;
    case isTemporalPlainDateObject(value):
      return TemporalPlainDate;
    case isTemporalPlainDateTimeObject(value):
      return TemporalPlainDateTime;
    case isTemporalPlainMonthDayObject(value):
      return TemporalPlainMonthDay;
    case isTemporalPlainTimeObject(value):
      return TemporalPlainTime;
    case isTemporalPlainYearMonthObject(value):
      return TemporalPlainYearMonth;
    case isTemporalZonedDateTimeObject(value):
      return TemporalZonedDateTime;
    case value instanceof ObjectValue && value.internalSlotsList.includes('InspectorEntry'):
      return InternalInspectorEntry;
    default:
      // Reaching here with a primitive means a value class the cases above do
      // not name. Describing it as a plain object would misreport it, but the
      // inspector's job is to survive an unknown value rather than to fail the
      // session, so it falls back to the string form its description gives.
      return value instanceof ObjectValue ? DefaultObject : UnknownPrimitive;
  }
}
