import type { Inspector } from './index.mts';
import {
  BigIntValue, SymbolDescriptiveString,
  type BooleanValue,
  type JSStringValue,
  type NullValue,
  type NumberValue,
  type SymbolValue,
  type TypedNumberValue,
  type Value,
  type UndefinedValue,
  type VectorValue,
} from '#self';

/**
 * proposal-runtime-types: the name of a value's type, for display. The
 * inspector cannot import `displayType` (it is not on the public surface), and
 * only needs the simple cases a typed primitive can carry.
 */
function typeNameOf(record: unknown): string {
  const t = record as { Name?: string, Kind?: string, Arguments?: readonly unknown[] } | undefined;
  if (t === undefined || t === null) {
    return 'typed';
  }
  if (typeof t.Name === 'string') {
    const args = globalThis.Array.isArray(t.Arguments) ? t.Arguments : [];
    // A numeric value type carries its width as a type ARGUMENT - `uint32` is
    // { Name: 'uint', Arguments: [32] } - so the name the source spelled is the
    // two joined. The general form is kept for anything else parameterized.
    if (args.length === 1 && typeof args[0] === 'number') {
      return `${t.Name}${args[0]}`;
    }
    if (args.length > 0) {
      return `${t.Name}.<${args.map((a) => globalThis.String(a)).join(', ')}>`;
    }
    return t.Name;
  }
  return typeof t.Kind === 'string' ? t.Kind : 'typed';
}

export const Null: Inspector<NullValue> = {
  toRemoteObject: () => ({ type: 'object', subtype: 'null', value: null }),
  toObjectPreview: () => ({
    type: 'object', subtype: 'null', properties: [], overflow: false,
  }),
  toPropertyPreview: (name) => ({
    name, type: 'object', subtype: 'null', value: 'null',
  }),
  toDescription: () => '',
};

export const Undefined: Inspector<UndefinedValue> = {
  toRemoteObject: () => ({ type: 'undefined' }),
  toObjectPreview: () => ({
    type: 'undefined', properties: [], overflow: false,
  }),
  toPropertyPreview: (name) => ({
    name, type: 'undefined', value: 'undefined',
  }),
  toDescription: () => 'undefined',
};

export const Boolean: Inspector<BooleanValue> = {
  toRemoteObject: (value) => ({ type: 'boolean', value: value.booleanValue() }),
  toPropertyPreview: (name, value) => ({
    name, type: 'boolean', value: value.booleanValue().toString(),
  }),
  toObjectPreview(value) {
    return {
      type: 'boolean',
      value: value.booleanValue(),
      description: value.booleanValue().toString(),
      overflow: false,
      properties: [],
    };
  },
  toDescription: (value) => value.booleanValue().toString(),
};

export const Symbol: Inspector<SymbolValue> = {
  toRemoteObject: (value, getObjectId) => ({
    type: 'symbol',
    description: SymbolDescriptiveString(value).stringValue(),
    objectId: getObjectId(value),
  }),
  toPropertyPreview: (name, value) => ({
    name, type: 'symbol', value: SymbolDescriptiveString(value).stringValue(),
  }),
  toObjectPreview: (value) => ({
    type: 'symbol',
    description: SymbolDescriptiveString(value).stringValue(),
    overflow: false,
    properties: [],
  }),
  toDescription: (value) => SymbolDescriptiveString(value).stringValue(),
};

export const String: Inspector<JSStringValue> = {
  toRemoteObject: (value) => ({ type: 'string', value: value.stringValue() }),
  toPropertyPreview(name, value) {
    return {
      name, type: 'string', value: value.stringValue(),
    };
  },
  toObjectPreview(value) {
    return {
      type: 'string',
      description: value.stringValue(),
      overflow: false,
      properties: [],
    };
  },
  toDescription: (value) => value.stringValue(),
};

/**
 * proposal-runtime-types: a TYPED number - `uint32.parse('4')`, `5 := uint8`,
 * or any arithmetic result that carries a value type.
 *
 * It is a distinct value class rather than a NumberValue subclass, so it
 * matched no case in getInspector and fell through to the object branch, where
 * reading `internalSlotsList` off a primitive threw and took the whole
 * inspector down. Reported as: "TypeError: can't access property 'includes',
 * value.internalSlotsList is undefined".
 *
 * It presents as a number, since that is what devtools can render, with the
 * type name in the description so the distinction is visible.
 */
export const TypedNumber: Inspector<TypedNumberValue> = {
  toRemoteObject(value, _getObjectId, context) {
    const v = value.value;
    const description = this.toDescription(value, context);
    if (Object.is(v, -0) || !globalThis.Number.isFinite(v)) {
      return { type: 'number', unserializableValue: v.toString(), description };
    }
    return { type: 'number', value: v, description };
  },
  toPropertyPreview(name, value, context) {
    return { name, type: 'number', value: this.toDescription(value, context) };
  },
  toObjectPreview(value, context) {
    return {
      type: 'number',
      description: this.toDescription(value, context),
      overflow: false,
      properties: [],
    };
  },
  toDescription: (value) => `${value.value} (${typeNameOf(value.TypeRecord)})`,
};

/**
 * A primitive value class the dispatch does not name. Describing it as an
 * object would misreport it and reading object internals off it would throw,
 * so it renders as its type tag - enough to see what is there, and safe for any
 * value class added later.
 */
export const UnknownPrimitive: Inspector<Value> = {
  toRemoteObject(value, _getObjectId, context) {
    return { type: 'string', value: this.toDescription(value, context), description: this.toDescription(value, context) };
  },
  toPropertyPreview(name, value, context) {
    return { name, type: 'string', value: this.toDescription(value, context) };
  },
  toObjectPreview(value, context) {
    return {
      type: 'string', description: this.toDescription(value, context), overflow: false, properties: [],
    };
  },
  toDescription: (value) => `[${(value as { type?: string }).type ?? 'value'}]`,
};

/** proposal-runtime-types: a vector value, shown as its lanes. */
export const Vector: Inspector<VectorValue> = {
  toRemoteObject(value, _getObjectId, context) {
    return { type: 'string', value: this.toDescription(value, context), description: this.toDescription(value, context) };
  },
  toPropertyPreview(name, value, context) {
    return { name, type: 'string', value: this.toDescription(value, context) };
  },
  toObjectPreview(value, context) {
    return {
      type: 'string',
      description: this.toDescription(value, context),
      overflow: false,
      properties: [],
    };
  },
  toDescription: (value) => {
    const lanes = value.lanes.map((lane) => {
      const l = lane as { value?: unknown };
      return l && l.value !== undefined ? globalThis.String(l.value) : globalThis.String(lane);
    });
    return `${typeNameOf(value.TypeRecord)}(${lanes.join(', ')})`;
  },
};

export const Number: Inspector<NumberValue> = {
  toRemoteObject(value) {
    const v = value.value;
    let description = v.toString();
    const isNeg0 = Object.is(v, -0);
    // Includes values `-0`, `NaN`, `Infinity`, `-Infinity`, and bigint literals.
    if (isNeg0 || !globalThis.Number.isFinite(v)) {
      if (typeof v === 'bigint') {
        description += 'n';
        return { type: 'bigint', unserializableValue: description, description };
      }
      return { type: 'number', unserializableValue: description, description: isNeg0 ? '-0' : description };
    }
    return { type: 'number', value: v, description };
  },
  toPropertyPreview(name, value, context) {
    return {
      name, type: 'number', value: this.toDescription(value, context),
    };
  },
  toObjectPreview(value, context) {
    return {
      type: 'number',
      description: this.toDescription(value, context),
      overflow: false,
      properties: [],
    };
  },
  toDescription: (value) => {
    const r = value.value;
    return value instanceof BigIntValue ? `${r}n` : r.toString();
  },
};
