import { Q } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import type { ClassFieldDefinitionRecord } from '../runtime-semantics/ClassFieldDefinitionEvaluation.mts';
import { TakePendingCalleeContext } from '../type-system/runtime.mts';
import { PlanOrdinaryNominalConversion } from './scalar-rest-storage.mts';
import { ConvertValue, ConversionTargetConstructor } from './runtime-types.mts';
import { isECMAScriptFunctionObject } from './function-operations.mts';
import {
  Construct, Get, Throw, IsCallable, OrdinaryInboundConversions, OrdinaryGetOwnProperty, OrdinaryCreateFromConstructor,
  InitializeInstanceElements, RequireFieldsInitialized, UninitializedFieldsOf,
  Descriptor, JSStringValue, ObjectValue, PrivateName, Value, type FunctionObject, type ECMAScriptFunctionObject,
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

/** A field the literal names: the value it gave and the expression that gave it. */
interface SuppliedField {
  readonly value: Value;
  readonly node: ParseNode;
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
 * The supplied value at the field's type. A nested object literal at a field
 * whose type is a class fills that class in turn, as the outer literal fills
 * this one; anything else converts as a member of a structural target does.
 */
export function* ConvertSuppliedField(supplied: SuppliedField, fieldType: TypeRecord | undefined): ValueEvaluator {
  if (fieldType === undefined) return supplied.value;
  const nested = objectLiteralOf(supplied.node);
  if (nested && supplied.value instanceof ObjectValue) {
    const filled = Q(yield* FillClassFromObjectLiteral(nested, supplied.value, fieldType));
    if (filled !== undefined) return filled;
  }
  return Q(yield* ConvertValue(supplied.value, fieldType));
}

/**
 * The explicit conversion of an operand's _value_ to _t_, as `operand := T`
 * makes it (#sec-explicit-conversion): an object literal converted to a class
 * fills it, and any other value converts as a typed binding would. A call on a
 * typed class with one argument is the same operation, and is evaluated by it.
 */
export function* ConvertOperandValue(operand: ParseNode, value: Value, t: TypeRecord): ValueEvaluator {
  const literal = objectLiteralOf(operand);
  if (literal && value instanceof ObjectValue) {
    const filled = Q(yield* FillClassFromObjectLiteral(literal, value, t));
    if (filled !== undefined) return filled;
  }
  return Q(yield* ConvertValue(value, t));
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
      }
    }
    if (slots.ConstructorKind === 'base') return { fields, readonlyWriters, constructedBy };
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
    Q(yield* instance.PreventExtensions());
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
