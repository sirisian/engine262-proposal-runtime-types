import {
  Value, ObjectValue, JSStringValue, SymbolValue, NumberValue,
  Descriptor, TypedNumberValue, unwrapToNumber,
  type PropertyKeyValue, type Arguments,
} from '../value.mts';
import { Q, X, type ValueCompletion } from '../completion.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { orderKey, makePrimitive, type TypeRecord } from '../type-system/records.mts';
import { RuntimeTypeOf } from '../type-system/runtime.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { isTypeObject } from '../type-system/intern.mts';
import { R } from "../abstract-ops/all.mjs";
import {
  OrdinaryObjectCreate, DefinePropertyOrThrow, Get,
  IsArray, Throw, surroundingAgent, CreateBuiltinFunction,
} from '#self';


/**
 * proposal-runtime-types, `sec-composites`.
 *
 * A composite is a frozen, null-prototyped object that is INTERNED: two
 * creations from the same contents are the same object. Equality of contents is
 * therefore identity, so `===`, `Map`, `Set` and `Array.prototype.includes`
 * compare composites structurally with no change to any of them - the
 * comparison each already performs finds one object where the contents are one.
 *
 * This is the DESIGN's typed composites. The upstream Composites proposal is the
 * base it layers on, and this file follows the specification clause; where the
 * two differ, `sec-composite-deviations` records it.
 */

/**
 * `sec-composite-registry`: the registry belongs to the HEAP.
 *
 * Under the worker model a heap is an agent and the two spellings coincide, so
 * hanging it on the Agent is correct today - but the threading extension shares
 * one heap across threads, and a registry scoped more finely than objects are
 * reachable would put two composites of equal contents, both reachable from
 * both threads, in one heap. Named for the heap so that work does not have to
 * find it.
 */
const heapCompositeRegistry = new WeakMap<object, Map<string, ObjectValue>>();

function registryOfHeap(): Map<string, ObjectValue> {
  const heap = surroundingAgent as unknown as object;
  let registry = heapCompositeRegistry.get(heap);
  if (!registry) {
    registry = new Map();
    heapCompositeRegistry.set(heap, registry);
  }
  return registry;
}

/** Every composite created in this heap, for `IsComposite`. */
const composites = new WeakSet<ObjectValue>();

/** `sec-iscomposite`. A Proxy over a composite is not a composite. */
export function IsComposite(value: Value): boolean {
  return value instanceof ObjectValue && composites.has(value);
}

/**
 * `sec-canonicalizecompositevalue`.
 *
 * The canonical representative of _value_'s SameValueZero equivalence class
 * within its type, so that a composite's contents do not depend on which member
 * reached the creation. Values of distinct types are never SameValueZero-equal,
 * so the class is always within one type.
 *
 * The classes with more than one member are the signed zeros - for Number and
 * for each binary float width - and the decimal cohorts. Every other value is
 * alone in its class and canonicalizes to itself, which is why most of the type
 * universe needs no step: integers, Strings, BigInts, Booleans, Symbols,
 * Objects, and rationals, the last because the type keeps every value in lowest
 * terms.
 *
 * THE DECIMAL STEPS ARE ABSENT DELIBERATELY. The decimal types resolve and
 * annotate in this engine and no value of one can be made, so there is no
 * cohort to reduce; writing the steps would be writing code no value reaches.
 * typed-zero-equality.test.mts pins that absence.
 */
export function CanonicalizeCompositeValue(value: Value): Value {
  // Detected with SameValue against `-0`, NOT by reading a mathematical value:
  // a mathematical value has no signed zero, so `R(v)` erases the very thing
  // this step exists to find. The lint rule that asks for `R` is about
  // MATHEMATICAL comparisons, and this is a REPRESENTATION one.
  if (value instanceof NumberValue && NumberValue.sameValue(value, Value(-0)) === Value.true) {
    return Value(+0);
  }
  if (value instanceof TypedNumberValue) {
    const asNumber = unwrapToNumber(value as TypedNumberValue);
    if (NumberValue.sameValue(asNumber, Value(-0)) === Value.true) {
      // The positive zero OF THAT TYPE, not a plain +0: a composite stores the
      // value at its own type, and the two are not interchangeable here.
      const positive = (value as unknown as { withNumber?: (n: number) => Value }).withNumber;
      if (typeof positive === 'function') {
        return positive.call(value, +0);
      }
    }
  }
  return value;
}

/** `sec-composite-entry-records`. */
interface CompositeEntryRecord {
  readonly Key: JSStringValue;
  readonly Value: Value;
}

/**
 * `sec-compositecanonicalorder`: integer-indexed keys first in ascending
 * numeric order, then the remaining String keys lexicographically. A composite
 * is therefore a canonical form independent of the source's enumeration order,
 * which is what makes `Composite({x:1,y:4})` and `Composite({y:4,x:1})` one
 * object.
 */
function CompositeCanonicalOrder(entries: readonly CompositeEntryRecord[]): CompositeEntryRecord[] {
  const isIndex = (k: string): boolean => String(Number(k) >>> 0) === k;
  const indexed = entries.filter((e) => isIndex(e.Key.stringValue()));
  const named = entries.filter((e) => !isIndex(e.Key.stringValue()));
  indexed.sort((a, b) => Number(a.Key.stringValue()) - Number(b.Key.stringValue()));
  named.sort((a, b) => (a.Key.stringValue() < b.Key.stringValue() ? -1 : 1));
  return [...indexed, ...named];
}

/**
 * The registry key for a set of sorted entries.
 *
 * The clause describes a search over the registry comparing with CompositeMatch
 * and says so explicitly: it "describes the required observable result and is
 * not an implementation model", requiring interning whose cost per creation is
 * on average sublinear in the population. A keyed map is that, and the key has
 * to distinguish exactly what CompositeMatch distinguishes - the KIND, the key
 * names, and each value under SameValueZero, which for a typed value means its
 * type as well as its payload.
 */
function registryKeyFor(kind: 'record' | 'tuple', entries: readonly CompositeEntryRecord[]): string {
  const parts = entries.map((entry) => `${entry.Key.stringValue()}=${valueKeyFor(entry.Value)}`);
  return `${kind}:${parts.join('\u0001')}`;
}

function valueKeyFor(value: Value): string {
  const v = value as unknown as {
    TypeRecord?: { Name?: string }, numberValue?: () => number, stringValue?: () => string,
  };
  if (value instanceof TypedNumberValue) {
    // The TYPE is part of the key, through the type system's own canonical
    // order key rather than a field read off the record. Reading `.Name`
    // produced the same string for every typed number, so `uint8(1)` and
    // `uint16(1)` interned together - SameValueZero tells them apart and the
    // registry did not, which is the one place those two must agree.
    const record = (value as unknown as { TypeRecord?: TypeRecord }).TypeRecord;
    const typeKey = record ? orderKey(record) : '?';
    return `t:${typeKey}:${R(unwrapToNumber(value as TypedNumberValue))}`;
  }
  if (value instanceof NumberValue) {
    return `n:${R(value as NumberValue)}`;
  }
  if (value instanceof JSStringValue) {
    return `s:${v.stringValue!()}`;
  }
  if (value instanceof ObjectValue || (value as { type?: string }).type === 'Symbol') {
    // Identity, not contents: "an object field compares by identity, so
    // `Composite({ v: {} }) !== Composite({ v: {} })` while two mentions of the
    // SAME object are one key". A nested composite lands here too and keys
    // correctly, because interning has already made equal contents one object.
    return `o:${objectIdentity(value as unknown as object)}`;
  }
  return `p:${String((value as unknown as { toString(): string }).toString())}`;
}

let nextIdentity = 0;
const identities = new WeakMap<object, number>();
function objectIdentity(value: object): number {
  let id = identities.get(value);
  if (id === undefined) {
    nextIdentity += 1;
    id = nextIdentity;
    identities.set(value, id);
  }
  return id;
}

/**
 * `sec-compositeshape`: the shape a composite's contents determine.
 *
 * The type of each field is the runtime type of its value, WITH THREE
 * EXCEPTIONS the clause states and which are easy to miss: a field whose value
 * is an Object records `any`, a field whose value is a composite records that
 * composite's OWN type, and a field whose value is a Type Object records
 * `type`. Without the first, two composites holding different objects would
 * claim different shapes, and shapes are what type identity is computed from.
 */
export function CompositeShape(entries: readonly CompositeEntryRecord[]): TypeRecord {
  const Properties = entries.map((entry) => ({
    key: entry.Key.stringValue(),
    type: compositeFieldType(entry.Value),
    optional: false,
    readonly: true,
  }));
  return { Kind: 'object', Properties, IndexSignatures: [] } as TypeRecord;
}

/** `sec-compositefieldtype`. */
function compositeFieldType(value: Value): TypeRecord {
  const stamped = compositeTypes.get(value as ObjectValue);
  if (stamped) {
    return stamped;
  }
  if (isTypeObject(value)) {
    return makePrimitive('type');
  }
  if (value instanceof ObjectValue) {
    return makePrimitive('any');
  }
  return RuntimeTypeOf(value);
}

/**
 * `sec-composite-types`: "A Type Record is a composite type when its [[Kind]] is
 * ~primitive~ and its [[Name]] is *\"Composite\"*", with [[Arguments]] the
 * shape. NOT a Type Record kind of its own - which is why no `switch` over
 * kinds needed touching, and why these canonicalize through the ordinary type
 * interning by canonicalizing the shape in [[Arguments]].
 */
export function CompositeTypeOver(shape: TypeRecord): TypeRecord {
  return makePrimitive('Composite', [shape]);
}

/** The top composite type, `Composite` with no arguments. */
export function TopCompositeType(): TypeRecord {
  return makePrimitive('Composite', []);
}

/** Every composite's own type, so `Reflect.typeOf` and a nested field find it. */
const compositeTypes = new WeakMap<ObjectValue, TypeRecord>();

export function CompositeTypeRecordOf(value: Value): TypeRecord | undefined {
  return value instanceof ObjectValue ? compositeTypes.get(value) : undefined;
}

/** `sec-findorcreatecomposite`. */
export function FindOrCreateComposite(entries: readonly CompositeEntryRecord[]): ValueCompletion {
  const sorted = CompositeCanonicalOrder(entries);
  const registry = registryOfHeap();
  const key = registryKeyFor('record', sorted);
  const found = registry.get(key);
  if (found) {
    return found;
  }
  const c = OrdinaryObjectCreate(Value.null);
  for (const entry of sorted) {
    X(DefinePropertyOrThrow(c, entry.Key, Descriptor({
      Value: entry.Value,
      Writable: Value.false,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
  }
  c.Extensible = Value.false;
  compositeTypes.set(c, CompositeTypeOver(CompositeShape(sorted)));
  composites.add(c);
  registry.set(key, c);
  return c;
}

/**
 * `sec-compositefromshape`: the TYPED creation.
 *
 * "each supplied value is CONVERTED to its member's type, a required absence
 * throws, an undeclared property throws, and an optional member's declared
 * default is FILLED, before canonicalization and interning."
 *
 * The default matters most and is the rule composites make unarguable: a
 * default belongs to CONSTRUCTION and is written before freezing, so it is part
 * of the contents that intern - `Composite.<CacheKey>({id: 7})` and
 * `Composite.<CacheKey>({id: 7, page: 0})` are one object. A CHECK of a
 * composite that already exists writes nothing, because a frozen shared object
 * is where filling at a check is not merely undesirable but impossible.
 */
export function* CompositeFromShape(shape: TypeRecord, source: Value): ValueEvaluator {
  if (!(source instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', source);
  }
  // "the S that is T's STRUCTURAL FORM" - an interface resolves to a ~nominal~
  // record carrying its structure, and the clause is written over the structure
  // rather than the name. Reading `Kind === 'object'` alone sent every
  // interface down the tuple path, which is what a name-shaped type looks like
  // when only the structural spelling was considered.
  const structural = shape.Kind === 'object'
    ? shape
    : (shape as { Structure?: TypeRecord }).Structure;
  if (!structural || structural.Kind !== 'object') {
    // The tuple half is phase four's second part, with the tuple kind itself.
    return Throw.TypeError('$1 is not supported yet', Value('a typed tuple composite'));
  }
  const properties = structural.Properties;
  const entries: CompositeEntryRecord[] = [];
  const keys = Q(yield* source.OwnPropertyKeys());
  for (const key of keys) {
    const desc = Q(yield* source.GetOwnProperty(key as PropertyKeyValue));
    if (desc !== Value.undefined && (desc as Descriptor).Enumerable === Value.true) {
      if (!(key instanceof JSStringValue)) {
        return Throw.TypeError('$1 is not a valid composite key', key as Value);
      }
      const declared = properties.find((prop) => prop.key === key.stringValue());
      if (!declared) {
        // "an undeclared property throws" - the shape states the members, and a
        // composite created at a shape has exactly them.
        return Throw.TypeError('$1 is not a member of this type', key);
      }
      const v = Q(yield* Get(source, key));
      const converted = Q(yield* ConvertValue(v, declared.type as TypeRecord));
      entries.push({ Key: key, Value: CanonicalizeCompositeValue(converted) });
    }
  }
  for (const declared of properties) {
    if (entries.some((entry) => entry.Key.stringValue() === declared.key)) {
      continue;
    }
    const initial = (declared as { initial?: Value }).initial;
    if (initial !== undefined) {
      // CONVERTED to the member's type, exactly as a supplied value is. Filling
      // the raw default made `Composite.<K>({id: 7})` store a Number `page`
      // where `Composite.<K>({id: 7, page: 0})` stored a `uint8` - so the two
      // spellings of one key did NOT intern, which is the property the clause's
      // own example asserts.
      const convertedDefault = Q(yield* ConvertValue(initial, declared.type as TypeRecord));
      entries.push({ Key: Value(declared.key as string), Value: CanonicalizeCompositeValue(convertedDefault) });
      continue;
    }
    if (!declared.optional) {
      // "a required absence throws".
      return Throw.TypeError('$1 is missing from this composite', Value(declared.key as string));
    }
  }
  return Q(FindOrCreateComposite(entries));
}

/** `sec-composite-arg`: `Composite ( source )`. */
function* CompositeFunction([source = Value.undefined]: Arguments, { NewTarget }: { NewTarget: Value }) {
  // "is not a constructor; `new Composite(...)` throws".
  if (NewTarget !== Value.undefined) {
    return Throw.TypeError('$1 is not a constructor', Value('Composite'));
  }
  if (!(source instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an object', source);
  }
  const isArray = Q(IsArray(source));
  if (isArray === Value.true) {
    // The tuple kind is phase four of PLAN-composites.md. Refused rather than
    // silently treated as a record: `sec-composite-deviations` keeps the array
    // form and gives it its OWN kind in the intern key, so answering with a
    // record here would produce an object that a later phase must invalidate.
    return Throw.TypeError('$1 is not supported yet', Value('a tuple composite'));
  }
  const entries: CompositeEntryRecord[] = [];
  const keys = Q(yield* source.OwnPropertyKeys());
  for (const key of keys) {
    const desc = Q(yield* source.GetOwnProperty(key as PropertyKeyValue));
    if (desc !== Value.undefined && (desc as Descriptor).Enumerable === Value.true) {
      if (key instanceof SymbolValue) {
        return Throw.TypeError('$1 is not a valid composite key', key);
      }
      // Getters run EAGERLY and exactly once each, in the order the keys are
      // reported - which is why the source is read here rather than lazily.
      const v = Q(yield* Get(source, key as PropertyKeyValue));
      entries.push({ Key: key as JSStringValue, Value: CanonicalizeCompositeValue(v) });
    }
  }
  return Q(FindOrCreateComposite(entries));
}

/** `Composite.isComposite ( value )`. */
function Composite_isComposite([value = Value.undefined]: Arguments) {
  return IsComposite(value) ? Value.true : Value.false;
}

export function bootstrapComposite(realmRec: Realm) {
  // NOT bootstrapConstructor: `Composite` "is not a constructor; `new
  // Composite(...)` throws", and a constructor bootstrap would give it a
  // `prototype` property and mark it constructible. A plain builtin function
  // with `isComposite` hung off it is what the clause describes.
  const composite = CreateBuiltinFunction(CompositeFunction as never, 1, Value('Composite'), [], realmRec);
  const isComposite = CreateBuiltinFunction(Composite_isComposite as never, 1, Value('isComposite'), [], realmRec);
  X(DefinePropertyOrThrow(composite, Value('isComposite'), Descriptor({
    Value: isComposite,
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.true,
  })));
  // The global binding is added by the global-object pass from
  // %Composite%; the global object does not exist yet at intrinsic time.
  realmRec.Intrinsics['%Composite%'] = composite;
}
