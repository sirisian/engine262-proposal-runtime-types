import { Q } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import type { ClassFieldDefinitionRecord } from '../runtime-semantics/ClassFieldDefinitionEvaluation.mts';
import { DefaultValueOf, TakePendingCalleeContext } from '../type-system/runtime.mts';
import { LiteralTextValueAt } from '../static-semantics/NumericValue.mts';
import { PlanOrdinaryNominalConversion } from './scalar-rest-storage.mts';
import { ConvertValue, ConversionTargetConstructor } from './runtime-types.mts';
import { isECMAScriptFunctionObject, SealTypedInstance } from './function-operations.mts';
import {
  Construct, CreateDataPropertyOrThrow, Get, Throw, IsCallable, OrdinaryInboundConversions, OrdinaryGetOwnProperty, OrdinaryCreateFromConstructor,
  InitializeInstanceElements, RequireFieldsInitialized, UninitializedFieldsOf,
  Descriptor, JSStringValue, NumberValue, ObjectValue, PrivateName, Value, isTypedNumber, type FunctionObject, type ECMAScriptFunctionObject,
} from '#self';

/**
 * An object literal converted to a class (#sec-object-literal-conversion).
 *
 * `{ x: 1, y: 2 } := Vertex` makes a `Vertex` whose fields hold what the
 * literal names, where no class in `Vertex`'s chain declares a constructor or a
 * field the literal cannot name - a private or a protected one. Such a class
 * has no code of its own that construction runs except its field
 * initializers, so `new Vertex()` followed by a store to each field makes the
 * same instance; the literal does it in one expression, which is what an
 * operator that returns a new value of its own class needs. A field the
 * literal does not name is initialized as `new` initializes it, by its
 * initializer or its type's default; a field it names takes the literal's
 * value, converted to the field's type as `:=` converts each member of a
 * structural target, and its initializer does not run.
 *
 * A class held by reference that declares a constructor says how it is made,
 * and a literal does not go around it: it converts only by a conversion the
 * class declares (#sec-user-defined-conversions), as before. A value class is
 * filled whether or not it declares one. Its instances come into existence
 * without a constructor already - its default, each copy, each element of an
 * array of it (#sec-value-type-copying) - so its constructor is not what every
 * instance was made by, and the literal fills it without running one, naming
 * only fields any code may write: not a `readonly` field whose class declares
 * a constructor, which is that constructor's to write. That is
 * `{ v: this.v + rhs.v } := Vector4` in an operator of a `Vector4` that also
 * declares `constructor(x, y, z, w)`.
 *
 * The literal is evaluated first, as any object literal is, and its values are
 * read from the object it makes; that object is reachable from nothing else.
 */

/**
 * A field the literal names: the value it gave and the expression that gave
 * it, or, for a parsed object, how its value converts to the field's type.
 */
interface SuppliedField {
  readonly value: Value;
  readonly node?: ParseNode;
  readonly convert?: (fieldType: TypeRecord | undefined) => ValueEvaluator;
}

interface LiteralFill {
  readonly fields: Map<string, SuppliedField>;
}

/**
 * The fill of the construction that is about to create its instance. It is
 * claimed by the instance the class's default constructor creates
 * (`TakePendingLiteralFill`), so a construction that a field initializer runs
 * later is not filled from it.
 */
let pendingFill: LiteralFill | undefined;
const fills = new WeakMap<object, LiteralFill>();

/** Called where a default constructor creates its instance, as a placement is taken there. */
export function TakePendingLiteralFill(instance: object): void {
  if (pendingFill !== undefined) {
    fills.set(instance, pendingFill);
    pendingFill = undefined;
  }
}

/** The value the literal gave the field _name_ of the instance being filled, if it gave one. */
export function SuppliedFieldOf(receiver: object, name: unknown): SuppliedField | undefined {
  if (!(name instanceof JSStringValue)) return undefined;
  return fills.get(receiver)?.fields.get(name.stringValue());
}

/**
 * The supplied value at the field's type. A nested literal fills at the
 * field's type as the outer literal fills this one (`ConvertOperandValue`);
 * anything else converts as a member of a structural target does.
 */
export function* ConvertSuppliedField(supplied: SuppliedField, fieldType: TypeRecord | undefined): ValueEvaluator {
  if (supplied.convert) return Q(yield* supplied.convert(fieldType));
  if (fieldType === undefined || supplied.node === undefined) return supplied.value;
  // A literal whose field type the checker did not know, as through a type
  // parameter, is read from its text as where the class is written.
  if (supplied.value instanceof NumberValue && !isTypedNumber(supplied.value)) {
    const exact = LiteralTextValueAt(supplied.node, fieldType);
    if (exact !== undefined) return Q(exact);
  }
  return Q(yield* ConvertOperandValue(supplied.node, supplied.value, fieldType));
}

/**
 * The explicit conversion of an operand's _value_ to _t_, as `operand := T`
 * makes it (#sec-explicit-conversion): an object literal converted to a class
 * fills it, and any other value converts as a typed binding would. A call on a
 * typed class with one argument is the same operation, and is evaluated by it.
 */
export function* ConvertOperandValue(operand: ParseNode, value: Value, t: TypeRecord): ValueEvaluator {
  const filled = Q(yield* FillFromLiteral(operand, value, t, 0));
  if (filled !== undefined) return filled;
  return Q(yield* ConvertValue(value, t));
}

/**
 * Question AJ, AJ2: the class a literal converted to _t_ fills. A class fills
 * itself. Of a union, the one class among members that are otherwise `null`
 * and `undefined` fills, as Swift promotes a value to an optional: `{ x: 1 } :=
 * (V | null)` is a `V`. A union of two classes names no one class a literal
 * fills, and the literal converts as a structural value, which it cannot.
 */
function FilledClassOf(t: TypeRecord): TypeRecord | undefined {
  if (t.Kind === 'nominal') return t;
  if (t.Kind !== 'union') return undefined;
  const others = (t.Members as readonly TypeRecord[]).filter((m) => !(m.Kind === 'primitive' && (m.Name === 'null' || m.Name === 'undefined')));
  return others.length === 1 && others[0]!.Kind === 'nominal' ? others[0] : undefined;
}

/** The type of the element at _index_ of an array or tuple type, where one type is that position's. */
function ElementTypeAt(t: TypeRecord, index: number): TypeRecord | undefined {
  if (t.Kind === 'array') return t.Element;
  if (t.Kind !== 'tuple') return undefined;
  const elements = (t as unknown as { Elements: readonly { Type: TypeRecord, Rest?: boolean, Spread?: boolean }[] }).Elements;
  if (elements.some((e) => e.Rest || e.Spread)) return undefined;
  return elements[index]?.Type;
}

/**
 * Question AJ, AJ2: what a literal operand fills at _t_, or undefined where it
 * fills nothing and converts as any value does. An object literal fills the
 * class _t_ names (`FilledClassOf`). An array literal at an array or a tuple
 * type passes each of its elements to its position's type, so `[{ x: 1 }] :=
 * [].<V>` fills a `V` at index 0, as a field of a class type is filled, and
 * the array then converts with the elements it now holds. A position after a
 * spread is not known from the literal and is left as it is.
 */
function* FillFromLiteral(operand: ParseNode, value: Value, t: TypeRecord, depth: number): PlainEvaluator<Value | undefined> {
  if (!(value instanceof ObjectValue) || depth > 64) return undefined;
  const literal = objectLiteralOf(operand);
  if (literal) {
    const target = FilledClassOf(t);
    if (target === undefined) return undefined;
    return Q(yield* FillClassFromObjectLiteral(literal, value, target));
  }
  let array: ParseNode | undefined = operand;
  while (array?.type === 'ParenthesizedExpression') array = array.Expression;
  if (array?.type !== 'ArrayLiteral' || (t.Kind !== 'array' && t.Kind !== 'tuple')) return undefined;
  let index = 0;
  for (const element of array.ElementList) {
    if (element.type === 'SpreadElement') break;
    if (element.type !== 'Elision') {
      const elementType = ElementTypeAt(t, index);
      if (elementType !== undefined) {
        const key = Value(String(index));
        const current = Q(yield* Get(value, key));
        const filled = Q(yield* FillFromLiteral(element, current, elementType, depth + 1));
        if (filled !== undefined) Q(yield* CreateDataPropertyOrThrow(value, key, filled));
      }
    }
    index += 1;
  }
  return undefined;
}

/** The object literal _node_ is, under its parentheses. */
export function objectLiteralOf(node: ParseNode | undefined): ParseNode.ObjectLiteral | undefined {
  let n = node;
  while (n?.type === 'ParenthesizedExpression') n = n.Expression;
  return n?.type === 'ObjectLiteral' ? n : undefined;
}

type ChainVerdict =
  | {
    readonly fields: ReadonlySet<string>,
    /**
     * Each `readonly` field whose declaring class declares a constructor, with
     * that class: the constructor is what writes it, past its initializer.
     */
    readonly readonlyWriters: ReadonlyMap<string, string>,
    /** The class of the chain that declares a constructor, where the class is a value class that has one. */
    readonly constructedBy: string | undefined,
    /** Each public field with no initializer, and the type it declares. */
    readonly uninitialized: ReadonlyMap<string, TypeRecord | undefined>,
  }
  | { readonly refused: string, readonly detail?: string };

/**
 * Whether instances of _ctor_ are filled from a literal: every class of its
 * chain is a class definition with no instance field but a public one, and
 * none declares a constructor unless _ctor_ is a value class. Answers the
 * public field names, or why not.
 */
function* fillableChain(ctor: FunctionObject): PlainEvaluator<ChainVerdict> {
  const fields = new Set<string>();
  const readonlyWriters = new Map<string, string>();
  const uninitialized = new Map<string, TypeRecord | undefined>();
  // Every class of a value class's chain is one (a class over a value class is
  // declared `value`), so the class itself answers for the chain.
  const valueClass = (ctor as { ValueClass?: boolean }).ValueClass === true;
  let constructedBy: string | undefined;
  let at: Value = ctor;
  for (let depth = 0; depth < 1024; depth += 1) {
    if (!(at instanceof ObjectValue)) return { refused: 'base' };
    const slots = at as unknown as { Fields?: readonly ClassFieldDefinitionRecord[], ConstructorKind?: 'base' | 'derived' };
    // A class that writes a constructor is an ECMAScript function object; one
    // that does not is given a default constructor, a built-in function that
    // carries the class's fields. A built-in such as `Array` carries none.
    const declaresConstructor = isECMAScriptFunctionObject(at);
    if (declaresConstructor) {
      if (!valueClass) return { refused: 'constructor', detail: displayClass(at) };
      constructedBy ??= displayClass(at);
    }
    if (!Array.isArray(slots.Fields) || slots.ConstructorKind === undefined) return { refused: 'base', detail: displayClass(at) };
    for (const field of slots.Fields) {
      // An `accessor` field is stored under a Private Name that backs its pair.
      if (field.AccessorPair !== undefined || field.LayoutName !== undefined) {
        const shown = field.LayoutName instanceof JSStringValue ? field.LayoutName.stringValue() : 'an accessor';
        return { refused: 'accessor', detail: shown };
      }
      if (field.Name instanceof PrivateName) {
        const description = (field.Name as unknown as { Description?: { stringValue?(): string } }).Description?.stringValue?.() ?? '';
        return { refused: 'private', detail: description.startsWith('#') ? description : `#${description}` };
      }
      if (field.Access === 'protected' && field.Name instanceof JSStringValue) {
        return { refused: 'protected', detail: field.Name.stringValue() };
      }
      if (field.Name instanceof JSStringValue) {
        fields.add(field.Name.stringValue());
        if (field.Readonly && declaresConstructor) readonlyWriters.set(field.Name.stringValue(), displayClass(at));
        if (field.Initializer === undefined) {
          uninitialized.set(field.Name.stringValue(), (field as { TypeObject?: { TypeRecord?: TypeRecord } }).TypeObject?.TypeRecord);
        } else {
          uninitialized.delete(field.Name.stringValue());
        }
      }
    }
    if (slots.ConstructorKind === 'base') return { fields, readonlyWriters, constructedBy, uninitialized };
    at = Q(yield* (at as ObjectValue).GetPrototypeOf());
  }
  return { refused: 'base' };
}

function displayClass(F: Value): string {
  const own = F instanceof ObjectValue ? OrdinaryGetOwnProperty(F, Value('name')) : undefined;
  const name = own instanceof Descriptor ? own.Value : undefined;
  return name instanceof JSStringValue && name.stringValue() !== '' ? name.stringValue() : 'an anonymous class';
}

/**
 * Why a property of the literal names no field it can fill, or undefined for
 * a field value - `name: value`, or `name` alone.
 */
function propertyForm(property: ParseNode): string | undefined {
  switch (property.type) {
    case 'IdentifierReference':
      return undefined;
    case 'PropertyDefinition': {
      const definition = property as ParseNode.PropertyDefinition;
      if (definition.PropertyName === null) return 'a spread';
      if (definition.PropertyName.type === 'PropertyName') return 'a computed name';
      if ((definition as { TypeAnnotation?: unknown }).TypeAnnotation) return 'a typed own property';
      if (keyOf(definition) === '__proto__') return '__proto__';
      return undefined;
    }
    case 'CoverInitializedName':
      return 'a default';
    default:
      return 'a method or an accessor';
  }
}

function keyOf(property: ParseNode): string {
  if (property.type === 'IdentifierReference') return property.name;
  const name = (property as ParseNode.PropertyDefinition).PropertyName as { name?: string, value?: string | number | bigint };
  return String(name.name ?? name.value);
}

function valueNodeOf(property: ParseNode): ParseNode {
  return property.type === 'IdentifierReference' ? property : (property as ParseNode.PropertyDefinition).AssignmentExpression;
}

/**
 * The instance of the class _t_ names, filled from the object _value_ that the
 * object literal _literal_ evaluated to; or undefined where _t_ is not such a
 * class, or the class declares a conversion that takes the literal, so the
 * ordinary conversion is to run.
 */
export function* FillClassFromObjectLiteral(literal: ParseNode.ObjectLiteral, value: ObjectValue, t: TypeRecord): PlainEvaluator<Value | undefined> {
  if (t.Kind !== 'nominal') return undefined;
  const ctor = Q(yield* ConversionTargetConstructor(t));
  if (ctor === undefined || !(ctor instanceof ObjectValue)) return undefined;
  const chain = Q(yield* fillableChain(ctor as FunctionObject));
  // A conversion the class declares is how it says a value becomes one, so it
  // is the conversion wherever it takes the literal; the fill is for a class
  // that has said nothing.
  if ('refused' in chain || OrdinaryInboundConversions(t).some((entry) => IsCallable(entry.Function))) {
    const planned = Q(yield* PlanOrdinaryNominalConversion(value, t));
    if (planned === undefined && 'refused' in chain) {
      const target = Value(displayType(t));
      switch (chain.refused) {
        case 'constructor':
          return Throw.TypeError('an object literal converts to $1 only by a conversion it declares, since $2 declares a constructor; construct it with new', target, Value(chain.detail ?? 'its class'));
        case 'private':
          return Throw.TypeError('an object literal converts to $1 only by a conversion it declares, since its field $2 is private and a literal cannot name it', target, Value(chain.detail ?? ''));
        case 'protected':
          return Throw.TypeError('an object literal converts to $1 only by a conversion it declares, since its field $2 is protected and a literal cannot name it', target, Value(chain.detail ?? ''));
        case 'accessor':
          return Throw.TypeError('an object literal converts to $1 only by a conversion it declares, since its field $2 is an accessor, whose storage a literal cannot name', target, Value(chain.detail ?? ''));
        default:
          return Throw.TypeError('an object literal converts to $1 only by a conversion it declares, since $2 in its chain is not a class definition', target, Value(chain.detail ?? 'a base'));
      }
    }
    if (planned !== undefined || 'refused' in chain) return undefined;
  }
  if ((ctor as { IsAbstract?: boolean }).IsAbstract) {
    return Throw.TypeError('$1 is an abstract class and cannot be instantiated', ctor);
  }
  const supplied = new Map<string, SuppliedField>();
  for (const property of literal.PropertyDefinitionList) {
    const form = propertyForm(property);
    if (form !== undefined) {
      return Throw.TypeError('$1 is filled from an object literal that names its fields, and this one has $2', Value(displayType(t)), Value(form));
    }
    const key = keyOf(property);
    if (!chain.fields.has(key)) {
      return Throw.TypeError('$1 has no field named $2', Value(displayType(t)), Value(key));
    }
    const writer = chain.readonlyWriters.get(key);
    if (writer !== undefined) {
      return Throw.TypeError('$1 is filled from an object literal without running the constructor $2 declares, and that constructor is what writes its readonly field $3; construct it with new', Value(displayType(t)), Value(writer), Value(key));
    }
    supplied.set(key, { value: Q(yield* Get(value, Value(key))), node: valueNodeOf(property) });
  }
  pendingFill = { fields: supplied };
  try {
    if (chain.constructedBy === undefined) {
      return Q(yield* Construct(ctor as FunctionObject, [], ctor as FunctionObject));
    }
    return Q(yield* ConstructWithoutConstructors(ctor as FunctionObject));
  } finally {
    pendingFill = undefined;
  }
}

/**
 * The instance of the value class _F_ that a construction makes with no
 * constructor body of its chain run: each class of the chain initializes its
 * fields, base first, as a class that declares no constructor does, and the
 * instance is sealed as `new` seals it. A field whose type has no default and
 * which has no initializer is one only a constructor could have assigned, so
 * the literal must name it.
 */
function* ConstructWithoutConstructors(F: FunctionObject): PlainEvaluator<ObjectValue> {
  // A context handed to a construction is consumed by it, as both
  // construction paths consume one, so no initializer that runs sees it.
  TakePendingCalleeContext();
  const instance = Q(yield* initializeChain(F, F));
  const unassigned = UninitializedFieldsOf(instance);
  if (unassigned !== undefined && unassigned.size > 0) {
    const [field] = unassigned.values();
    return Throw.TypeError('$1 is filled from an object literal that does not name $2, whose type has no default', Value(displayClass(F)), Value(field.display));
  }
  Q(RequireFieldsInitialized(F, instance));
  if ((F as { SealInstances?: boolean }).SealInstances) {
    Q(yield* SealTypedInstance(instance));
  }
  return instance;
}

function* initializeChain(F: FunctionObject, newTarget: FunctionObject): PlainEvaluator<ObjectValue> {
  let instance: ObjectValue;
  if ((F as { ConstructorKind?: 'base' | 'derived' }).ConstructorKind === 'derived') {
    const parent = Q(yield* F.GetPrototypeOf());
    instance = Q(yield* initializeChain(parent as FunctionObject, newTarget));
  } else {
    instance = Q(yield* OrdinaryCreateFromConstructor(newTarget, '%Object.prototype%'));
    TakePendingLiteralFill(instance);
  }
  Q(yield* InitializeInstanceElements(instance, F as ECMAScriptFunctionObject));
  return instance;
}

/**
 * Question AK, AK2: `JSON.parse.<C>` builds a class by the literal's rule
 * (#sec-object-literal-conversion), the two ways to make an instance from named
 * fields agreeing. A class with no constructor in its chain, and a value class,
 * is filled from the parsed object: each key names a field and its value
 * converts to that field's type as the parse converts any member (_coerce_), a
 * field the object omits takes its initializer or its type's default, and a
 * key no field has is refused, as is an omitted field with neither. A class held
 * by reference that declares a constructor says how it is made, and data from
 * outside does not go around it: it is built only by a conversion it declares
 * from the parsed object, as Kotlin's serialization runs a class's `init`
 * blocks and Rust's serde builds only a type that opts in. Undefined where _t_
 * names no class.
 */
export function* FillClassFromParsedObject(value: ObjectValue, t: TypeRecord, path: string,
  coerce: (member: Value, fieldType: TypeRecord | undefined, key: string) => ValueEvaluator): PlainEvaluator<Value | undefined> {
  if (t.Kind !== 'nominal') return undefined;
  const ctor = Q(yield* ConversionTargetConstructor(t));
  if (ctor === undefined || !(ctor instanceof ObjectValue) || (ctor as { IsClassConstructor?: Value }).IsClassConstructor !== Value.true) return undefined;
  const where = path === '' ? '' : `at ${path}: `;
  const chain = Q(yield* fillableChain(ctor as FunctionObject));
  if ('refused' in chain || OrdinaryInboundConversions(t).some((entry) => IsCallable(entry.Function))) {
    const planned = Q(yield* PlanOrdinaryNominalConversion(value, t));
    if (planned !== undefined) return Q(yield* ConvertValue(value, t));
    if ('refused' in chain) {
      const why = chain.refused === 'constructor' ? `${chain.detail ?? 'its class'} declares a constructor`
        : chain.refused === 'private' ? `its field ${chain.detail ?? ''} is private`
          : chain.refused === 'protected' ? `its field ${chain.detail ?? ''} is protected`
            : chain.refused === 'accessor' ? `its field ${chain.detail ?? ''} is an accessor`
              : `${chain.detail ?? 'a base'} in its chain is not a class definition`;
      return Throw.TypeError('$1', Value(`${where}a parsed object becomes ${displayType(t)} only by a conversion it declares, since ${why}`));
    }
  }
  if ((ctor as { IsAbstract?: boolean }).IsAbstract) {
    return Throw.TypeError('$1 is an abstract class and cannot be instantiated', ctor);
  }
  const supplied = new Map<string, SuppliedField>();
  for (const k of Q(yield* value.OwnPropertyKeys())) {
    if (!(k instanceof JSStringValue)) continue;
    const key = k.stringValue();
    if (!chain.fields.has(key)) return Throw.TypeError('$1', Value(`${where}unknown key "${key}"`));
    const writer = chain.readonlyWriters.get(key);
    if (writer !== undefined) {
      return Throw.TypeError('$1', Value(`${where}${displayType(t)} is filled without running the constructor ${writer} declares, and that constructor is what writes its readonly field "${key}"`));
    }
    const member = Q(yield* Get(value, k));
    supplied.set(key, { value: member, convert: (fieldType) => coerce(member, fieldType, key) });
  }
  for (const [key, fieldType] of chain.uninitialized) {
    if (supplied.has(key) || fieldType === undefined) continue;
    if (Q(yield* DefaultValueOf(fieldType)) === undefined) {
      return Throw.TypeError('$1', Value(`${where}missing required key "${key}"`));
    }
  }
  pendingFill = { fields: supplied };
  try {
    if (chain.constructedBy === undefined) {
      return Q(yield* Construct(ctor as FunctionObject, [], ctor as FunctionObject));
    }
    return Q(yield* ConstructWithoutConstructors(ctor as FunctionObject));
  } finally {
    pendingFill = undefined;
  }
}
