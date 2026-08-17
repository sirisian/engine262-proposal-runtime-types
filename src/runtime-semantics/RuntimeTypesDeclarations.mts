import { BigIntValue, NumberValue, ObjectValue, SymbolValue, Value, isTypedNumber, wellKnownSymbols } from '../value.mts';
import { StampTypedArray } from '../abstract-ops/array-view.mts';
import { CheckedConvertValue, LookupClassOperator } from '../abstract-ops/runtime-types.mts';
import {
  CreateDecimalValue, decimalAdd, isDecimalObject, type DecimalObject,
} from '../intrinsics/Decimal.mts';
import { JSStringValue, TypedString, TypedBigInt } from '../value.mts';
import type { Arguments } from '../value.mts';
import { ClaimEnumerator } from '../abstract-ops/runtime-types.mts';
import { CreateArrayFromList } from '../abstract-ops/all.mts';
import { SameType } from '../type-system/relations.mts';
import { TypedNumberValue } from '../value.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { EnsureCompletion, Q, X } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import { GetValue } from '../abstract-ops/all.mts';
import { iterationInterfaceRecord } from '../type-system/iteration-types.mts';
import { CanonicalizeType } from '../type-system/intern.mts';
import { GetTypeObject, isTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { beginResolvingAlias, endResolvingAlias, tieAliasKnot } from '../type-system/resolving-aliases.mts';
import { FirstInlineCycle } from '../type-system/layout.mts';
import { OriginOfNode, RecordTypeOrigin } from '../type-system/provenance.mts';
import { toNumericArgument,
  InstantiateGenericAlias, IsOfType, TypeNodeToTypeRecord,
  pushTypeParameterFrame, popTypeParameterFrame,
} from '../type-system/runtime.mts';
import { builtinTypeRecord, displayType, propertyKeyValue } from '../type-system/records.mts';
import { markBuiltinFunctionAsConstructor } from '../abstract-ops/function-operations.mts';
import { DefaultValueOf } from '../type-system/runtime.mts';
import { anyType } from '../type-system/records.mts';
import { ConvertValue, AssociateClassType, LookupClassType } from '../abstract-ops/runtime-types.mts';
import { JSStringValue as JSStringValueClass } from '../value.mts';
import {
  SameValue, HasProperty, Get, Call, IsCallable, IteratorToList, GetIterator,
  GetMethod, LengthOfArrayLike, ToBoolean, ToNumber, ArrayCreate, CreateBuiltinFunction,
  GetPrototypeFromConstructor,
} from '../abstract-ops/all.mts';
import { R as MathematicalValue } from "../abstract-ops/all.mjs";
import { ThrowCompletion } from '../completion.mts';
import { DeclarativeEnvironmentRecord } from '../execution-context/Environment.mts';
import { ClassDefinitionEvaluation } from './ClassDefinitionEvaluation.mts';
 import { Evaluate_PropertyName } from './PropertyName.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { InitializeBoundName } from './BindingInitialization.mts';
import { MetadataObjectFor } from './ClassDefinitionEvaluation.mts';
import { OrdinaryObjectCreate, CreateDataProperty } from '#self';
import { ClaimMetaKey, CreateDataPropertyOrThrow, MetadataAsObject, OrdinaryFunctionCreate, R, RegisterMetaDefaultSnapshot, RegisterMetaHook, RegisterMetaTypeName, RegisterTypeDefault, ResolveBinding, SnapshotMetadataValue, Throw, surroundingAgent } from '#self';

/**
 * proposal-runtime-types
 * Placeholder evaluation for the declarations introduced by the proposal: the
 * declared name is bound and initialized, and the declaration otherwise
 * evaluates to an empty completion. The type registry semantics that give the
 * bindings their values arrive with a later milestone.
 */
/**
 * proposal-runtime-types #sec-type-errors: the checking pass processes a source
 * text's type declarations before its body evaluates, which is what makes a
 * declaration visible to the judgments of the same source. A node the pass
 * evaluated is marked here, and its body-position evaluation becomes a no-op,
 * so registration and binding initialization happen exactly once.
 */
export const preEvaluatedTypeDeclarations = new WeakSet<ParseNode>();

export function* Evaluate_RuntimeTypesBindingDeclaration(node: ParseNode.TypeAliasDeclaration | ParseNode.InterfaceDeclaration | ParseNode.EnumDeclaration): PlainEvaluator {
  if (preEvaluatedTypeDeclarations.has(node)) {
    return undefined;
  }
  const name = StringValue(node.BindingIdentifier);
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  let value: Value = Value.undefined;
  if (node.type === 'TypeAliasDeclaration') {
    if (node.TypeParameters) {
      // A generic alias binds uninstantiated; instantiation substitutes the
      // parameters and interns the result.
      value = GetTypeObject({ Kind: 'nominal', Declaration: node, Arguments: [] });
    } else {
      // #sec-gettypeobject: the alias binds the interned Type Object of its Type.
      //
      // #sec-type-alias-declarations lets the Type refer to the alias itself.
      // The binding is in its dead zone throughout, and the record does not
      // exist yet, so an empty placeholder is published for the declaration and
      // a self-reference resolves to it (TypeNodeToTypeRecord). Once the Type is
      // resolved that same object is filled in place, which ties the knot, and
      // only THEN is anything canonicalized or interned: a union type node is
      // built uncanonicalized, so the one canonicalization that matters is the
      // GetTypeObject below, and by then the placeholder is the finished record.
      const placeholder = { Kind: 'object', Properties: [], IndexSignatures: [] } as unknown as TypeRecord;
      beginResolvingAlias(node, placeholder);
      let record;
      try {
        record = Q(yield* TypeNodeToTypeRecord(node.Type));
      } finally {
        endResolvingAlias(node);
      }
      if (record === placeholder) {
        // `type L = L;` - the alias's Type is the alias, so there is no
        // structure to be recursive THROUGH. It is not the finite-layout case
        // (there is no field closing a cycle) and it never denotes a type.
        return Throw.TypeError('$1 is defined as itself, so it denotes no type', Value(name.stringValue()));
      }
      tieAliasKnot(placeholder, record);
      // #sec-type-alias-declarations: "It is a type error if a cycle never
      // does, since the type would demand an infinite inline layout, which is
      // the same rule sec-typed-classes applies to a value type class
      // containing itself."
      const cycle = FirstInlineCycle(record);
      if (cycle !== null) {
        return Throw.TypeError('$1 contains itself through field $2, so it has no finite layout', Value(name.stringValue()), Value(cycle));
      }
      if (node.WhereClauses && node.WhereClauses.length > 0) {
        // proposal-runtime-types (dependentrecordtypes.md): a `where` clause
        // makes this a dependent record type. Its identity is the declaration's
        // (two textually identical `where` blocks are two types), so it binds as
        // a nominal type whose structure is the base record; the predicates ride
        // on the declaration and are checked at every boundary by IsOfType.
        value = GetTypeObject({
          Kind: 'nominal', Declaration: node, Arguments: [], Structure: record,
        });
      } else {
        value = GetTypeObject(record);
      }
    }
  } else if (node.type === 'EnumDeclaration') {
    // Enum members take their initializer's value, or the previous numeric
    // value plus one, starting from 0. The members are data properties of the
    // enum's Type Object, and membership is SameValue against the list.
    // The underlying type is resolved BEFORE the members, because every one of
    // them passes through it.
    const underlyingRecord = node.TypeAnnotation
      ? Q(yield* TypeNodeToTypeRecord(node.TypeAnnotation.Type))
      : builtinTypeRecord('int32') ?? undefined;
    // Numeric in the sense the clause means: an enumeration that numbers itself
    // from 0 needs a type those numbers are values of.
    const underlyingIsNumeric = underlyingRecord !== undefined
      && underlyingRecord.Kind === 'primitive'
      && /^(u?int|float|decimal)/.test(underlyingRecord.Name)
      && underlyingRecord.Name !== 'number'
      ? true
      : underlyingRecord?.Kind === 'primitive' && underlyingRecord.Name === 'number';

    const memberValues: Value[] = [];
    const memberNames: string[] = [];
    // Built before the members so each one can be tagged with it. `EnumMembers`
    // is the same array the loop fills, so the record is complete by the time
    // anything reads it.
    const enumRecord: TypeRecord = {
      Kind: 'nominal', Declaration: node, Arguments: [], EnumMembers: memberValues, Underlying: underlyingRecord ?? undefined,
    };
    let nextAuto = 0;
    let previous: Value | undefined;
    // The most recently given generator function, which a following enumerator
    // with no initializer is given the result of calling, "until an initializer
    // replaces it". An initializer that is not such a function sets its own
    // value "without disturbing the function for those after it".
    let generator: Value | undefined;
    for (const member of node.EnumMemberList) {
      let v: Value;
      if (member.Initializer) {
        const ref = Q(yield* Evaluate(member.Initializer));
        v = Q(yield* GetValue(ref));
        // "An enumerator initialized with a function of two parameters is given
        // the result of calling that function" - with the enumerator's index
        // and name, which is the design's
        // `enum Count: float32 { Zero = (index, name) => index * 100, One, Two }`.
        // The value was being converted as a function and refused.
        const arity = IsCallable(v)
          ? Q(yield* Get(v as ObjectValue, Value('length')))
          : Value.undefined;
        if (arity instanceof NumberValue && (R(arity) as number) === 2) {
          generator = v;
          v = Q(yield* Call(generator, Value.undefined, [Value(memberValues.length), Value(member.IdentifierName.name)]));
        }
      } else if (previous === undefined) {
        // #sec-enums: "The first enumerator, when it has no initializer, takes
        // 0, and it is a type error when the underlying type is not numeric,
        // since a non-numeric enumeration must define its starting value."
        if (!underlyingIsNumeric) {
          return Throw.TypeError('$1 is not assignable to $2', Value('an enumerator with no initializer'), Value('an enum whose underlying type is not numeric; give it a value'));
        }
        v = Value(nextAuto);
      } else if (generator !== undefined) {
        v = Q(yield* Call(generator, Value.undefined, [Value(memberValues.length), Value(member.IdentifierName.name)]));
      } else if (!underlyingIsNumeric) {
        // #sec-enums: a later enumerator with no initializer "takes the result
        // of applying the underlying type's prefix increment operator
        // `operator++` to the previous enumerator's value, with the previous
        // enumerator itself unmodified; where the underlying type declares no
        // prefix increment, it takes a value equal to the previous one".
        //
        // Reading only the Number family for that made EVERY other underlying
        // type take the repeat rule, so a `bigint` enumeration counted 1, 1, 1
        // and the design document's own `class A { operator++() }` example gave
        // every enumerator after the first the same value - silently, since the
        // declaration is accepted either way. The two arms below are the types
        // that DO declare a prefix increment and are not Number-family.
        const incOp = previous instanceof ObjectValue
          ? LookupClassOperator(previous, 'unary ++')
          : null;
        if (incOp !== null) {
          v = Q(yield* Call(incOp, previous, []));
        } else if (previous instanceof BigIntValue) {
          v = Value((R(previous as BigIntValue) as bigint) + 1n);
        } else {
          v = previous;
        }
      } else if (isDecimalObject(previous)) {
        // A decimal declares a prefix increment like any other numeric type, but
        // the value it produces cannot be reached through a Number: a decimal
        // carries a cohort member - `1.0` is 10 x 10^-1 where `1.00` is
        // 100 x 10^-2 - and converting a double to one is refused for exactly
        // that reason. So the step is taken IN the type, by adding the decimal
        // one at the previous enumerator's own width.
        const one = CreateDecimalValue(1n, 0, previous.DecimalWidth, surroundingAgent.currentRealmRecord);
        const sum = decimalAdd(previous, one as DecimalObject);
        v = CreateDecimalValue(sum.parts.significand, sum.parts.exponent, sum.width, surroundingAgent.currentRealmRecord);
      } else {
        // "A later enumerator with no initializer takes the result of applying
        // the underlying type's prefix increment operator to the one before."
        v = Value(nextAuto);
      }
      // #sec-enums: an enumerator's value is a value of the underlying type, so
      // it passes that type's boundary - `enum E: uint8 { A = 300 }` is the
      // mistake `let a: uint8 = 300` is, and was accepted here because nothing
      // read the underlying type the declaration had already resolved.
      if (underlyingRecord !== undefined) {
        v = Q(yield* CheckedConvertValue(v, underlyingRecord));
        // #sec-enums: "`Reflect.typeOf(Count.Zero)` reports `Count`, by the rule
        // that a value's runtime type is the most specific type of which it is
        // a value." The conversion above is what CHECKS the value and what
        // normalizes it; leaving the underlying type on it made an enumerator
        // report `uint8` where the clause says it reports the enum, and
        // membership in the underlying type follows from the subtype relation
        // rather than from a second runtime type.
        // #sec-enums: "Reflect.typeOf(Count.Zero) reports Count." An enumerator
        // carries its enum, which is also what lets membership tell one
        // declaration's value from another's - without it a value of one enum
        // satisfied an unrelated enum over the same underlying type.
        //
        // Each family takes the carrier its representation allows, and each is a
        // SUBCLASS or a fresh instance rather than a wrapper, so the value stays
        // usable as its underlying type: `S.A === "x"`, `1n === B.A`, and a
        // decimal's own equality all hold. Only TypedNumberValue is a sibling of
        // its base, which is the numeric family's own rule.
        if (v instanceof TypedNumberValue) {
          v = new TypedNumberValue((v as TypedNumberValue).value, enumRecord);
        } else if (v instanceof JSStringValue) {
          v = TypedString((v as JSStringValue).stringValue(), enumRecord);
        } else if (v instanceof BigIntValue) {
          v = TypedBigInt(R(v as BigIntValue) as bigint, enumRecord);
        } else if (isDecimalObject(v)) {
          // A fresh decimal rather than a slot on the one the program wrote: an
          // enumerator may be written from a shared binding, and tagging that
          // would claim someone else's object. A decimal is compared by content,
          // so the copy is SameValue-equal to the original.
          v = CreateDecimalValue(
            v.DecimalSignificand,
            v.DecimalExponent,
            v.DecimalWidth,
            surroundingAgent.currentRealmRecord,
            enumRecord,
          );
        } else if (v instanceof SymbolValue || v instanceof ObjectValue) {
          // A symbol, a class instance, and a function are compared by IDENTITY,
          // so the enumerator IS the value the program wrote - which is what
          // keeps `A.X === k`, `A.X.v`, and `A.X instanceof K` true. There is
          // nowhere on such a value to put an enum that belongs to one of
          // possibly several, so the claim is recorded outside it.
          //
          // #sec-enums: a value may be an enumerator of at most one enum. Without
          // that rule two enums share the value, and then `A.X is B` is true, a
          // B-typed parameter takes an A value, and `Reflect.typeOf` has no
          // single answer to give.
          const claimedBy = ClaimEnumerator(v, enumRecord);
          if (claimedBy !== undefined && !SameType(claimedBy, enumRecord)) {
            return Throw.TypeError(
              '$1 is already an enumerator of $2, and a value may be an enumerator of at most one enum',
              Value(member.IdentifierName.name),
              Value(displayType(claimedBy)),
            );
          }
        }
      }
      // #sec-enums: "A later enumerator with no initializer takes the result of
      // applying the underlying type's prefix increment operator to the one
      // before." Continue from the value just stored, whatever it converted to
      // - a converted enumerator is a TypedNumberValue rather than a Number, so
      // reading only the Number case counted from 0 again and made
      // `enum E: uint8 { A = 10, B }` report 1 rather than 11, and hid the
      // overflow in `{ A = 255, B }` behind the same reset.
      const numeric = NumericValueOfEnumerator(v);
      nextAuto = numeric === undefined ? nextAuto + 1 : numeric + 1;
      // #sec-enums: "It is a type error if two enumerators of one declaration
      // have the same name." Nothing checked it, so `enum E { A, A }` was
      // accepted and the later enumerator silently won - the same failure the
      // interface check above exists to prevent, where the meaning of a
      // declaration depends on which member is read.
      if (memberNames.includes(member.IdentifierName.name)) {
        return Throw.TypeError('$1 is already an enumerator of this enum', Value(member.IdentifierName.name));
      }
      previous = v;
      memberValues.push(v);
      memberNames.push(member.IdentifierName.name);
    }
    const obj = GetTypeObject(enumRecord);
    for (let i = 0; i < memberNames.length; i += 1) {
      X(CreateDataPropertyOrThrow(obj, Value(memberNames[i]), memberValues[i]));
      // The design's index operator: `Count[0]` is `Count.Zero` beside
      // `Count['Zero']`. By POSITION rather than by underlying value - the
      // design's own example cannot tell the two apart, since its enumerators
      // are numbered from 0, but an index operator beside a name lookup is
      // indexing the ENUMERATION, and position is what `keys()`, `values()`,
      // and `entries()` are ordered by. A lookup by VALUE already exists and
      // is spelled `Count(n)`, the reverse conversion.
      X(CreateDataPropertyOrThrow(obj, Value(String(i)), memberValues[i]));
    }
    value = obj;
  } else if (node.type === 'InterfaceDeclaration') {
    // The interface's structural shape: annotated members check their type,
    // method signatures check callability, and a member whose type cannot be
    // resolved checks presence only. Operators and index signatures join with
    // a later milestone.
    // The interface's structure is a real ~object~ record now; membership
    // rides the structural IsOfType case, while identity stays nominal.
    const Properties: { key: string | SymbolValue, type: TypeRecord, optional: boolean, readonly: boolean, initial?: Value }[] = [];
    for (const member of node.InterfaceMemberList) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const m = member as unknown as { PropertyName?: ParseNode & { name?: string, value?: string }, Readonly?: boolean, Optional?: boolean, TypeAnnotation?: ParseNode.TypeAnnotation | null, MethodSignature?: unknown };
      // A SYMBOL-KEYED member is written `[k]: T`, a COMPUTED property name -
      // an index signature needs an identifier and a `:` inside the brackets,
      // so the two forms do not collide. Its key has to be EVALUATED, and this
      // walk had taken only a literal name and dropped everything else: a
      // Property Type Record's [[Key]] is "a property key", which is a String
      // or a Symbol, and the record has held both since it was widened - only
      // this walk never produced one.
      //
      // That is what blocked the metadata half of the decorators extension.
      // decorators.md adds metadata through `partial interface ClassMetadata {
      // [myMetadata]: string }`, and a symbol key is the collision escape hatch
      // the design gives third-party libraries; the member merged and then
      // vanished, so nothing was ever enforced against it.
      let key: string | SymbolValue | undefined = m.PropertyName?.name ?? m.PropertyName?.value;
      if (typeof key !== 'string' && m.PropertyName) {
        const evaluated = EnsureCompletion(yield* Evaluate_PropertyName(m.PropertyName as never));
        if (evaluated.Type !== 'normal') {
          return evaluated;
        }
        const evaluatedKey = evaluated.Value;
        key = evaluatedKey instanceof SymbolValue
          ? evaluatedKey
          : (evaluatedKey as { stringValue?: () => string }).stringValue?.();
      }
      if (key === undefined) {
        continue;
      }
      let resolved: TypeRecord = { Kind: 'any' };
      if (m.TypeAnnotation) {
        const attempt = EnsureCompletion(yield* TypeNodeToTypeRecord(m.TypeAnnotation.Type));
        if (attempt.Type === 'normal') {
          resolved = attempt.Value as TypeRecord;
        }
      } else if (m.MethodSignature) {
        resolved = { Kind: 'function', Signatures: [] };
      }
      // The DECLARED DEFAULT travels with the member: a typed composite
      // creation fills it before freezing, so it is part of the contents that
      // intern.
      let initial;
      const memberInitializer = (m as { Initializer?: ParseNode | null }).Initializer;
      if (memberInitializer) {
        const attempt = EnsureCompletion(yield* Evaluate(memberInitializer));
        if (attempt.Type === 'normal') {
          initial = Q(yield* GetValue(attempt.Value as never));
        }
      }
      Properties.push({ key, type: resolved, optional: !!m.Optional, readonly: !!m.Readonly, initial });
    }
    // proposal-runtime-types decorators.md, #sec-metadata-objects: a `partial
    // interface` EXTENDS an interface someone else declared, and its members
    // join that interface's. It may contribute FIELDS where a partial class may
    // not, and the reason is the whole of why this is an interface: an
    // interface declares a SHAPE and adds no instance state, so nothing gains a
    // slot, no class's layout moves, and no sealed hierarchy is enlarged - the
    // three reasons the partial class clause gives for its own restriction.
    //
    // The shape stays complete at compile time, which is what an engine needs
    // to specialize access to it; what it does not do is put every declared key
    // on every object.
    if ((node as { Partial?: boolean }).Partial) {
      const existingRef = Q(yield* ResolveBinding(Value(name.stringValue())));
      const existing = Q(yield* GetValue(existingRef));
      if (!isTypeObject(existing)) {
        return Throw.TypeError('$1 is not an interface', name);
      }
      const priorRecord = existing.TypeRecord as TypeRecord & { Structure?: { Properties?: readonly { key: string | SymbolValue }[] } };
      const prior = priorRecord.Structure?.Properties ?? [];
      const seen = new Set(prior.map((pp) => pp.key));
      for (const added of Properties) {
        if (seen.has(added.key)) {
          // Two declarations of one member is a conflict rather than a merge:
          // silently taking the later would make the meaning of an interface
          // depend on load order.
          // A symbol key has no string spelling, so it is named by its
          // description in the message rather than rendered as one.
          return Throw.TypeError('$1 is already declared on this interface', typeof added.key === 'string'
            ? Value(added.key)
            : (added.key as SymbolValue));
        }
      }
      // The added members COMPLETE the existing record in place rather than
      // producing a new one to rebind.
      //
      // Type identity is by [[Declaration]], and a `partial interface` has a
      // declaration of its own - so a merged record built here would intern as
      // a SECOND type, and every type-position reference to the name would keep
      // resolving through the ORIGINAL declaration to the unmerged one. That is
      // cycle 104's lesson at a second site: rebinding the name is not the same
      // as changing the type, because a reference in type position reads the
      // declaration and not the binding.
      (priorRecord as { Structure?: { Kind: string, Properties: unknown[], IndexSignatures: unknown[] } }).Structure = {
        Kind: 'object',
        Properties: [...prior, ...Properties],
        IndexSignatures: [],
      };
      return undefined;
    }

    const record: TypeRecord = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      Structure: { Kind: 'object', Properties, IndexSignatures: [] },
    };
    value = GetTypeObject(record);
  }
  // #sec-provenance: record the declaration site this type came from. Interning
  // has already merged structurally identical shapes, so recording here IS the
  // union the clause specifies: `type A = { x: number }` and `type B = { x:
  // number }` reach one Type Object and both sites land on it. Nothing about the
  // type's identity reads this, and no program can: it is the host's channel.
  if (value !== Value.undefined) {
    RecordTypeOrigin(value as object, OriginOfNode(node, node.type, name.stringValue()));
  }
  Q(yield* InitializeBoundName(name, value, env));
  // proposal-runtime-types decorators.md: `@f enum Count { @f Zero, ... }`.
  // decorators.md "Order" puts members before their container, so the
  // ENUMERATORS run first and the enum's own decorators last - the same rule a
  // class and its fields follow, applied to a third container kind.
  if (surroundingAgent.feature('runtime-types') && node.type === 'EnumDeclaration') {
    const members = node.EnumMemberList ?? [];
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const decorators = (member as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
      if (!decorators?.length) {
        continue;
      }
      const memberName = (member as { IdentifierName?: { name?: string } }).IdentifierName?.name;
      Q(yield* ApplyDecorators(decorators, Q(yield* EnumDecoratorContext(
        'EnumEnumerator', typeof memberName === 'string' ? Value(memberName) : Value.undefined, value, { index },
      ))));
    }
    const own = (node as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
    if (own?.length) {
      // #sec-reflection-shape-enum: `valueType` is the Type Object of the type
      // the enumerators take their values in - the enum's Underlying, which the
      // declaration resolves and stores and nothing read until now. It reports
      // the DEFAULT where the program wrote no annotation, so a reader need not
      // know whether one was written.
      const underlyingRecord = (value as { TypeRecord?: { Underlying?: TypeRecord } }).TypeRecord?.Underlying;
      Q(yield* ApplyDecorators(own, Q(yield* EnumDecoratorContext('Enum', name, value, {
        size: members.length,
        valueType: underlyingRecord ? GetTypeObject(underlyingRecord) as Value : undefined,
      }))));
    }
  }

  return undefined;
}

/**
 * proposal-runtime-types
 * Evaluation of the expression forms: `is` is the IsOfType membership test,
 * `:=` applies the conversion rule, and `type` produces the interned Type
 * Object.
 */
export function* Evaluate_IsExpression({ Expression, Type, Pattern }: ParseNode.IsExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  // proposal-runtime-types `sec-is-pattern`: "`subject is P` is the one-arm
  // `match`, exactly." A |Type| is one |MatchPattern| form and keeps the path it
  // always had, so every existing `is` is unchanged.
  if (Pattern) {
    // `sec-is-pattern`: "`v is P` evaluates PatternMatches(P, the value of `v`,
    // a fresh Match Cache Record, env) ... where env is a new declarative
    // Environment Record in which P's BoundNames are created as immutable
    // bindings; the bindings are in scope in exactly the positions THE TRUTH OF
    // THE TEST GOVERNS ... each such position evaluating in env."
    //
    // The bindings are created in the RUNNING environment rather than in a
    // child that is discarded, because a governed position - an `if`
    // consequent, a `while` body, the right of `&&` - is evaluated by the
    // ENCLOSING construct, which knows nothing of a child environment the
    // operator made and threw away. That is what makes
    // `while (read() is Ok(let chunk))` a loop whose body sees `chunk`.
    //
    // **The restriction is the CHECKER's**, and the clause says so: "it is a
    // type error to reference one of those bindings anywhere else, and it is a
    // type error for a binding-carrying `is` to occur where no position is
    // governed by its truth". The runtime makes them REACHABLE; where they may
    // be read is a static question. Pinned until that lands.
    const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    for (const { name } of MatchPatternBoundNames(Pattern)) {
      // IMMUTABLE, as the clause says - `let` and `const` in a pattern mark a
      // binding SITE rather than a mutability, and neither is assignable after
      // the test.
      // MUTABLE at the record level, though the clause calls the binding
      // immutable: a LOOP re-evaluates its test, and an immutable binding
      // cannot be initialized twice - `while (read() is Ok(let chunk))` asserted
      // inside the host on its second iteration. The immutability the clause
      // wants is against USER ASSIGNMENT, which is the checker's to enforce
      // along with the scope; what the record needs is to accept a fresh value
      // per evaluation.
      const already = EnsureCompletion(yield* env.HasBinding(Value(name)));
      if (already.Type === 'normal' && already.Value === Value.false) {
        X(env.CreateMutableBinding(Value(name), Value.false));
        X(env.InitializeBinding(Value(name), Value.undefined));
      }
    }
    const attempt = EnsureCompletion(yield* PatternMatches(Pattern, value));
    if (attempt.Type !== 'normal') {
      return attempt as never;
    }
    return attempt.Value ? Value.true : Value.false;
  }
  const record = Q(yield* TypeNodeToTypeRecord(Type!));
  const result = Q(yield* IsOfType(value, record));
  return result ? Value.true : Value.false;
}

/**
 * `sec-matchconstant`: the sameValue comparison WITHIN ONE TYPE - *false* where
 * the operands' types differ, the type's sameValue where they are of one
 * numeric type, SameValue otherwise.
 *
 * A third relation beside SameValue and SameValueZero. The BARE-ZERO rule is
 * deliberately NOT here: `PatternMatches`' literal step applies it, because
 * inside this operation it would reach every constant comparison, including
 * interpolations and enumerators.
 */
export function MatchConstant(a: Value, b: Value): boolean {
  return SameValue(a, b);
}

/**
 * `sec-patternmatches`, the forms phase one of PLAN-pattern-matching.md
 * carries: combinators, `_`, literals, and the type pattern.
 *
 * It returns at the FIRST failure, so "user code a pattern can reach ... runs at
 * most once and only up to the deciding test" - which is why `and` returns
 * before evaluating its right operand on a miss, rather than computing both and
 * combining.
 */
/**
 * `sec-match-evaluation`.
 *
 * THE SUBJECT IS EVALUATED ONCE, before any pattern, and ONE cache serves every
 * clause - which is what makes "every pattern of one `match` sees the same
 * values" true and what lets arms agree about a getter they both name.
 *
 * Clauses are tried in source order and the first whose pattern matches
 * evaluates its body; "if no clause matches, a `TypeError` is thrown - and the
 * exhaustiveness rules make that throw statically impossible exactly where the
 * types can prove it", which is phase five's half.
 */
/** The names a clause's pattern binds, with whether each is `const`. */
function MatchClauseBoundNames(clause: ParseNode.MatchClause): { name: string, isConst: boolean }[] {
  return MatchPatternBoundNames(clause.Pattern);
}

/** The names a pattern binds, with whether each is `const`. */
function MatchPatternBoundNames(pattern: ParseNode.MatchPattern | null): { name: string, isConst: boolean }[] {
  const names: { name: string, isConst: boolean }[] = [];
  const walk = (p: ParseNode.MatchPattern | null): void => {
    if (!p) {
      return;
    }
    switch (p.type) {
      case 'MatchBindingPattern':
        names.push({ name: p.Name, isConst: p.IsConst });
        break;
      case 'MatchOrPattern':
      case 'MatchAndPattern':
        walk(p.Left);
        walk(p.Right);
        break;
      case 'MatchNotPattern':
        walk(p.Operand);
        break;
      case 'MatchObjectPattern':
        p.Properties.forEach((prop) => walk(prop.Pattern));
        break;
      case 'MatchArrayPattern':
        p.Elements.forEach(walk);
        break;
      case 'MatchExtractorPattern':
        p.Elements.forEach(walk);
        break;
      default:
        break;
    }
  };
  walk(pattern);
  return names;
}

export function* Evaluate_MatchExpression(node: ParseNode.MatchExpression): ValueEvaluator {
  const subjectRef = Q(yield* Evaluate(node.Expression as never));
  const subject = Q(yield* GetValue(subjectRef as never));
  const cache = NewMatchCache();
  // `match all` collects instead of returning: every clause is tried, every one
  // that matches contributes its arm's value, and the result is an Array in arm
  // order. An abrupt completion still propagates, which is what makes a
  // throwing arm abort the collection - the arms before it have already run.
  const collected: Value[] = [];
  for (const clause of node.Clauses) {
    // "A fresh declarative environment per clause with the clause's BoundNames
    // created" - so a binding of one arm is invisible to the next, and a `const`
    // binding is immutable where a `let` one is not.
    const outerEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    const clauseEnv = new DeclarativeEnvironmentRecord(outerEnv);
    for (const { name, isConst } of MatchClauseBoundNames(clause)) {
      if (isConst) {
        X(clauseEnv.CreateImmutableBinding(Value(name), Value.true));
      } else {
        X(clauseEnv.CreateMutableBinding(Value(name), Value.false));
      }
    }
    surroundingAgent.runningExecutionContext.LexicalEnvironment = clauseEnv;
    let matched = clause.Pattern === null;
    if (clause.Pattern) {
      const attempt = EnsureCompletion(yield* PatternMatches(clause.Pattern, subject, cache));
      if (attempt.Type !== 'normal') {
        surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
        return attempt as never;
      }
      matched = attempt.Value as unknown as boolean;
    }
    // A GUARD runs AFTER the pattern matches, and "a falsy guard fails the arm
    // and matching continues" - it does not abandon the match.
    if (matched && clause.Guard) {
      const guardRef = Q(yield* Evaluate(clause.Guard as never));
      const guard = Q(yield* GetValue(guardRef as never));
      matched = ToBoolean(guard) === Value.true;
    }
    if (!matched) {
      surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
      continue;
    }
    if (clause.IsBlock) {
      // proposal-runtime-types #sec-do-expression-modifications: a match arm's
      // Block IS a `do` expression's Block, and its value is its completion
      // value - which a Block already produces, so nothing special is computed
      // here. That was true under the narrower rule this replaces as well, so
      // no program changes meaning: what changes is that an arm may now END in
      // an `if` with an `else`, a `try`, or a `switch`, where the old rule made
      // those ~void~ and unreadable at the use site, and that an arm ending in
      // a declaration is a Syntax Error naming it rather than a silent ~void~.
      // A `return` or `break` inside propagates as the abrupt completion it is,
      // which is what makes the arm a block rather than a function body.
      const blockResult = EnsureCompletion(yield* Evaluate(clause.Body as never));
      // The clause environment must be dropped on EVERY exit, not only the ones
      // that fall through to the next clause. Leaving it installed made the
      // running context's LexicalEnvironment a child of the one the surrounding
      // code expects, so a `for` head containing a match then asked its loop
      // environment for a binding that lives one link up:
      //
      //   for (let i = match ([1]) { when [_]: 1; default: 0; }; i < 3; i++)
      //
      // crashed on `Assert(binding !== undefined)` inside
      // CreatePerIterationEnvironment. `var` was unaffected, having no
      // per-iteration environment to copy, and a match with no bound names
      // crashed too, since the clause environment is created either way - which
      // is why this is not about the bindings.
      surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
      if (blockResult.Type !== 'normal') {
        return blockResult as never;
      }
      const blockValue = (blockResult.Value ?? Value.undefined) as unknown as Value;
      if (node.All) {
        collected.push(blockValue);
        continue;
      }
      return blockValue;
    }
    const bodyRef = EnsureCompletion(yield* Evaluate(clause.Body as never));
    const body = bodyRef.Type === 'normal'
      ? EnsureCompletion(yield* GetValue(bodyRef.Value as never))
      : bodyRef;
    surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
    if (body.Type !== 'normal') {
      return body as never;
    }
    if (clause.IsThrow) {
      return ThrowCompletion(body.Value) as never;
    }
    if (node.All) {
      collected.push(body.Value as Value);
      continue;
    }
    return body.Value as Value;
  }
  if (node.All) {
    // No arm matching is an ANSWER rather than a missing case, which is why
    // exhaustiveness is not required of a `match all`. An empty list is what
    // "none of these hold" looks like.
    return X(CreateArrayFromList(collected));
  }
  return Throw.TypeError('$1 matched no clause of this match', subject);
}

export interface MatchCacheRecord {
  readonly Reads: { Object: Value, Key: string, Present: boolean, Value: Value }[];
  readonly Iterations: { Object: Value, Elements: Value[], Done: boolean }[];
}

/**
 * `sec-match-expression`: "A Match Cache Record has a [[Reads]] field ... and an
 * [[Iterations]] field ... It memoizes what a `match` reads of its subject, so
 * that a property is read at most once and an iterator is obtained at most once
 * however many patterns look, and every pattern of one `match` sees the same
 * values."
 *
 * A CORRECTNESS requirement, not an optimization: a getter that ran per test
 * would give different arms different values of one member.
 */
export function NewMatchCache(): MatchCacheRecord {
  return { Reads: [], Iterations: [] };
}

/**
 * The members of a type that may be matched MEMBER BY MEMBER through the cache,
 * or *undefined* where it may not.
 *
 * Three kinds of object type cannot be, each measured:
 *
 * - **OPTIONAL members**: `{ g?: uint8 }` matches `{}`, where a member-by-member
 *   test would require `g` present and answer *false*.
 * - **INDEX SIGNATURES**: `{ [k: string]: uint8 }` names no members to walk.
 * - **NOMINAL types**: a class rejects a plain object with the right members, so
 *   it can never become a structural test. An INTERFACE is structural here - a
 *   plain object matches one - and so may be routed through its Structure.
 */
function StructuralMemberTypes(t: TypeRecord): readonly { key: string, type: TypeRecord }[] | undefined {
  const shape = t.Kind === 'object'
    ? t
    : (t.Kind === 'nominal' && (t as { Declaration?: unknown }).Declaration === undefined
      ? (t as { Structure?: TypeRecord }).Structure
      : undefined);
  if (!shape || shape.Kind !== 'object') {
    return undefined;
  }
  if (shape.IndexSignatures.length > 0) {
    return undefined;
  }
  const members = [];
  for (const p of shape.Properties) {
    if (p.optional || typeof p.key !== 'string') {
      return undefined;
    }
    members.push({ key: p.key, type: p.type as TypeRecord });
  }
  return members.length > 0 ? members : undefined;
}

export function* PatternMatches(P: ParseNode.MatchPattern, subject: Value, cache: MatchCacheRecord = NewMatchCache()): PlainEvaluator<boolean> {
  switch (P.type) {
    case 'MatchOrPattern': {
      if (Q(yield* PatternMatches(P.Left, subject, cache))) {
        return true;
      }
      return Q(yield* PatternMatches(P.Right, subject, cache));
    }
    case 'MatchAndPattern': {
      if (!Q(yield* PatternMatches(P.Left, subject, cache))) {
        return false;
      }
      return Q(yield* PatternMatches(P.Right, subject, cache));
    }
    case 'MatchNotPattern':
      return !Q(yield* PatternMatches(P.Operand, subject, cache));
    case 'MatchWildcardPattern':
      return true;
    case 'MatchBindingPattern': {
      // "A binding always matches and always binds", and an ANNOTATED binding
      // tests first - which is `catch (e: TypeError)` in a new position.
      if (P.TypeAnnotation) {
        const record = Q(yield* TypeNodeToTypeRecord(P.TypeAnnotation));
        if (!Q(yield* IsOfType(subject, record))) {
          return false;
        }
      }
      const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      // SET rather than initialize where the binding already holds a value: a
      // loop's test runs once per iteration, and only the first can initialize.
      const bound = EnsureCompletion(yield* env.HasBinding(Value(P.Name)));
      if (bound.Type === 'normal' && bound.Value === Value.true) {
        const set = EnsureCompletion(yield* env.SetMutableBinding(Value(P.Name), subject, Value.false));
        if (set.Type !== 'normal') {
          X(env.InitializeBinding(Value(P.Name), subject));
        }
      } else {
        X(env.InitializeBinding(Value(P.Name), subject));
      }
      return true;
    }
    case 'MatchLiteralPattern': {
      const ref = Q(yield* Evaluate(P.Literal as never));
      const literal = Q(yield* GetValue(ref as never));
      // The BARE-ZERO step: a bare `0` matches both zeros of the position's
      // type, while an explicit `+0` or `-0` distinguishes them.
      if (P.BareZero && literal instanceof NumberValue && R(literal) === 0
          && subject instanceof NumberValue && R(subject) === 0) {
        return true;
      }
      return MatchConstant(subject, literal);
    }
    case 'MatchInterpolationPattern': {
      // "`${expression}` evaluates the expression and matches by SameValue
      // against the result, whatever the result is" - the escape hatch from
      // every cleverer rule, where a type pattern would test membership and an
      // expression pattern would consult a matcher.
      const ref = Q(yield* Evaluate(P.Expression as never));
      const value = Q(yield* GetValue(ref as never));
      return MatchConstant(subject, value);
    }
    case 'MatchObjectPattern': {
      // `sec-match-structural`. Presence is the `in` test, so an OPTIONAL
      // MEMBER THAT IS ABSENT FAILS the pattern rather than matching
      // *undefined* - and a member the pattern does not name is ignored, since
      // this type system has width subtyping and no exact object type.
      if (!(subject instanceof ObjectValue)) {
        return false;
      }
      for (const prop of P.Properties) {
        let read = cache.Reads.find((r) => r.Object === subject && r.Key === prop.Key);
        if (!read) {
          // ONE cached touch per key: a HasProperty and at most one Get,
          // however many patterns name it, so a getter runs once and every
          // pattern of one match sees the same value.
          const present = Q(yield* HasProperty(subject, Value(prop.Key)));
          const value = present === Value.true ? Q(yield* Get(subject, Value(prop.Key))) : Value.undefined;
          read = { Object: subject, Key: prop.Key, Present: present === Value.true, Value: value };
          cache.Reads.push(read);
        }
        if (!read.Present) {
          return false;
        }
        if (!Q(yield* PatternMatches(prop.Pattern, read.Value, cache))) {
          return false;
        }
      }
      // "The rest binding, where present, collects the REMAINING own enumerable
      // members" - remaining meaning those the pattern did not name, which is
      // why the named keys are excluded rather than the read ones: a key read
      // through the cache by an EARLIER pattern is still a member this one did
      // not name.
      const rest = (P as { Rest?: ParseNode.MatchBindingPattern | null }).Rest;
      if (rest) {
        const named = new Set(P.Properties.map((prop) => prop.Key));
        const remaining = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
        const keys = Q(yield* subject.OwnPropertyKeys());
        for (const key of keys) {
          if (!(key instanceof JSStringValueClass) || named.has((key as JSStringValueClass).stringValue())) {
            continue;
          }
          const desc = Q(yield* subject.GetOwnProperty(key as never));
          if (desc !== Value.undefined && (desc as { Enumerable?: unknown }).Enumerable === Value.true) {
            X(CreateDataProperty(remaining, key, Q(yield* Get(subject, key))));
          }
        }
        if (!Q(yield* PatternMatches(rest, remaining, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchArrayPattern': {
      // `sec-match-array`: matched "through ITERATION rather than through an
      // array test, which is what reaches every array-shaped value of this
      // proposal - a `[N].<T>` need not be an Array exotic object, a tuple
      // composite is iterable by kind rather than by prototype, and a typed
      // view answers no array predicate". A pattern that meant `Array.isArray`
      // would match the one shape that needed it least.
      let memo = cache.Iterations.find((it) => it.Object === subject);
      if (!memo) {
        memo = { Object: subject, Elements: [], Done: false };
        cache.Iterations.push(memo);
      }
      // Elements are pulled AS PATTERNS NEED THEM and memoized per subject, so
      // alternatives over array patterns of different lengths pull each element
      // once between them.
      const need = P.Elements.length + 1;
      if (!memo.Done && memo.Elements.length < need) {
        const iter = EnsureCompletion(yield* GetIterator(subject, 'sync'));
        if (iter.Type !== 'normal') {
          return false;
        }
        const iterated = EnsureCompletion(yield* IteratorToList(iter.Value as never));
        if (iterated.Type !== 'normal') {
          return false;
        }
        memo.Elements = iterated.Value as Value[];
        memo.Done = true;
      }
      // Without a rest element the iterator must be EXHAUSTED at the pattern's
      // length: `[let a, let b]` matches exactly two.
      if (memo.Elements.length !== P.Elements.length) {
        return false;
      }
      for (let i = 0; i < P.Elements.length; i += 1) {
        if (!Q(yield* PatternMatches(P.Elements[i]!, memo.Elements[i]!, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchRangePattern': {
      // `sec-matchrange`: containment, "at most two comparisons" - the form
      // that makes a FLOAT subject matchable at all, since a float has no cases
      // to enumerate.
      const ref = Q(yield* Evaluate(P.Range as never));
      const range = Q(yield* GetValue(ref as never));
      if (!(range instanceof ObjectValue)) {
        return false;
      }
      const contains = Q(yield* Get(range, Value('contains')));
      if (!IsCallable(contains)) {
        return false;
      }
      const answer = Q(yield* Call(contains, range, [subject]));
      return answer === Value.true;
    }
    case 'MatchRegExpPattern': {
      // `sec-matchregexp`: it matches the ENTIRE subject - "the whole-string
      // discipline this proposal uses everywhere a pattern constrains a
      // string" - so a search is spelled by writing the pattern as one.
      if (!(subject instanceof JSStringValueClass)) {
        return false;
      }
      const ref = Q(yield* Evaluate(P.RegExp as never));
      const re = Q(yield* GetValue(ref as never));
      if (!(re instanceof ObjectValue)) {
        return false;
      }
      const exec = Q(yield* Get(re, Value('exec')));
      if (!IsCallable(exec)) {
        return false;
      }
      const result = Q(yield* Call(exec, re, [subject]));
      if (!(result instanceof ObjectValue)) {
        return false;
      }
      const matched = Q(yield* Get(result, Value('0')));
      const index = Q(yield* Get(result, Value('index')));
      return matched instanceof JSStringValueClass
        && index instanceof NumberValue && MathematicalValue(index) === 0
        && matched.stringValue().length === subject.stringValue().length;
    }
    case 'MatchExtractorPattern': {
      // `sec-patternmatches`, the `MatchNamePattern ( MatchPatternList? )`
      // steps. "The typed protocol is a method, usually static, from the
      // subject to a tuple or `null`."
      const ref = Q(yield* Evaluate(P.Head as never));
      const head = Q(yield* GetValue(ref as never));
      if (!(head instanceof ObjectValue)) {
        return Throw.TypeError('$1 is not an object', head);
      }
      const matcher = Q(yield* GetMethod(head, wellKnownSymbols.customMatcher));
      if (matcher === Value.undefined) {
        return Throw.TypeError('$1 has no custom matcher', head);
      }
      const r = Q(yield* Call(matcher, head, [subject]));
      // "`null` is no match."
      if (r === Value.null) {
        return false;
      }
      if (!(r instanceof ObjectValue)) {
        // A BOOLEAN matcher takes no parentheses - "a boolean matcher with
        // parentheses, or a tuple matcher without them, is a type error, so the
        // two protocols cannot be confused silently".
        return Throw.TypeError('$1 is not a tuple', r);
      }
      const len = Q(yield* LengthOfArrayLike(r));
      if (len !== P.Elements.length) {
        // "A runtime TypeError where the counts disagree, so an extractor
        // reached through `any` FAILS LOUDLY rather than part-matching."
        return Throw.TypeError('$1 does not match the pattern\'s length', r);
      }
      for (let i = 0; i < P.Elements.length; i += 1) {
        const element = Q(yield* Get(r, Value(String(i))));
        if (!Q(yield* PatternMatches(P.Elements[i]!, element, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchTypePattern': {
      // A bare name that resolves to a VALUE with a custom matcher is a
      // MEMBERSHIP TEST through it - the parenthesis-free form `Composite`
      // uses. Reached here because a bare name parses as a |Type|; the type
      // path answers first where the name denotes one, which is what makes
      // `when Circle:` and `when Count.Zero:` read as the tests they are.
      const asType = EnsureCompletion(yield* TypeNodeToTypeRecord(P.Type));
      if (asType.Type === 'normal') {
        // QUESTION-match-cache-type-path.md: a STRUCTURAL object type is matched
        // MEMBER BY MEMBER THROUGH THE CACHE rather than by `IsOfType` on the
        // whole.
        //
        // The Match Cache Record is specified to memoize reads "so that a
        // property is read at most once HOWEVER MANY PATTERNS LOOK, and every
        // pattern of one `match` sees the same values" - but `IsOfType` is given
        // no cache at any of its five call sites, while every other
        // subject-touching operation takes one. Measured, that is not a
        // performance difference: with a getter returning 1 then 2,
        // `when { g: 2 }` / `when { g: 1 }` selected NO ARM through `IsOfType`
        // and `{ g: 1 }` through the pattern path. **The two spellings chose
        // different arms**, and which one a member takes is invisible in the
        // source.
        //
        // The reads are moved to where the cache already is, rather than the
        // cache into the type system: `IsOfType` keeps its signature and every
        // other caller is untouched.
        const structural = StructuralMemberTypes(asType.Value as TypeRecord);
        if (structural && subject instanceof ObjectValue) {
          for (const member of structural) {
            let read = cache.Reads.find((r) => r.Object === subject && r.Key === member.key);
            if (!read) {
              const present = Q(yield* HasProperty(subject, Value(member.key)));
              const value = present === Value.true ? Q(yield* Get(subject, Value(member.key))) : Value.undefined;
              read = { Object: subject, Key: member.key, Present: present === Value.true, Value: value };
              cache.Reads.push(read);
            }
            if (!read.Present) {
              return false;
            }
            if (!Q(yield* IsOfType(read.Value, member.type))) {
              return false;
            }
          }
          return true;
        }
        return Q(yield* IsOfType(subject, asType.Value as TypeRecord));
      }
      // Not a type: evaluate the name as the member expression it spells and
      // dispatch on the VALUE. A boolean matcher reached WITHOUT parentheses is
      // a membership test - the form `Composite` uses - and "a matcher that
      // returns an object there is a TypeError, as parentheses on a boolean
      // matcher are, so the two protocols cannot be confused silently".
      const nameRef = EnsureCompletion(yield* Evaluate(P.Type as never));
      if (nameRef.Type !== 'normal') {
        return Q(asType);
      }
      const named = Q(yield* GetValue(nameRef.Value as never));
      if (named instanceof ObjectValue) {
        const nameMatcher = Q(yield* GetMethod(named, wellKnownSymbols.customMatcher));
        if (nameMatcher !== Value.undefined) {
          const answer = Q(yield* Call(nameMatcher, named, [subject]));
          if (answer instanceof ObjectValue) {
            return Throw.TypeError('$1 returned a tuple where a Boolean was required', named);
          }
          return ToBoolean(answer) === Value.true;
        }
      }
      // "Anything else is a constant compared by SameValue, which for an
      // interned composite is one pointer comparison."
      return MatchConstant(subject, named);
    }
    default:
      return false;
  }
}

export function* Evaluate_TypedConversionExpression({ Expression, Type }: ParseNode.TypedConversionExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return Q(yield* ConvertValue(value, record));
}

export function* Evaluate_TypeOperatorExpression({ Type }: ParseNode.TypeOperatorExpression): ValueEvaluator {
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return GetTypeObject(record);
}
/**
 * proposal-runtime-types #sec-meta-hooks: evaluate the `default` hook and
 * register it against the named type's interned Type Object.
 */
export function* Evaluate_MetaDeclaration(node: ParseNode.MetaDeclaration): PlainEvaluator {
  if (preEvaluatedTypeDeclarations.has(node)) {
    return undefined;
  }
  if (node.TypeName.MemberNames.length > 0) {
    return undefined;
  }
  const name = node.TypeName.IdentifierReference.name;
  const record = builtinTypeRecord(name);
  let typeObject: Value | null = record ? GetTypeObject(record) : null;
  if (!typeObject) {
    const ref = Q(yield* ResolveBinding(Value(name)));
    const candidate = Q(yield* GetValue(ref));
    typeObject = isTypeObject(candidate) ? candidate : null;
  }
  if (!typeObject) {
    return undefined;
  }
  // #sec-primitive-metadata: a meta type claims the property keys of its
  // constraint shape, and it is an error at the SECOND declaration for two meta
  // types to claim one key. The claim is what lets a metadata value select the
  // meta type that governs it, which is how `meta Dimensions` reaches a
  // `float32.<{ m, s }>` it never names.
  const shape = record ?? (isTypeObject(typeObject) ? (typeObject as { TypeRecord?: TypeRecord }).TypeRecord : undefined);
  if (shape && shape.Kind === 'object') {
    for (const property of shape.Properties) {
      const conflict = ClaimMetaKey(property.key, typeObject as object);
      if (conflict !== undefined) {
        return Throw.TypeError('$1 is already claimed by another meta type', propertyKeyValue(property.key));
      }
    }
  }
  let sawDefault = false;
  let sawSubtype = false;
  for (const hook of node.MetaHookList) {
    if (hook.type === 'MetaDefaultHook') {
      const ref = Q(yield* Evaluate(hook.AssignmentExpression));
      const v = Q(yield* GetValue(ref));
      RegisterTypeDefault(typeObject, v);
      // sec-metadataportion copies the default, so where the constraint shape
      // is an OBJECT type the default must be an object, and it is snapshotted
      // here, once, into the host metadata-record shape: a getter on it runs
      // at declaration and never again, and MetadataPortion starts from the
      // snapshot (the plan's Phase 1). A declaration over a non-object shape,
      // the suite's `meta uint8 { default = 0 }`, keeps its scalar default for
      // the annotated-binding path and registers no snapshot: it claims no
      // keys, so no portion of it exists to complete. The full C5 rule, that
      // the default is a VALUE OF the constraint shape, waits on the plan's
      // P1f verdict about optional-key membership.
      if (shape && shape.Kind === 'object') {
        if (!(v instanceof ObjectValue)) {
          return Throw.TypeError('a meta type whose constraint shape is an object type requires an object default');
        }
        // The full C5 rule (the plan's relocated edit 5): `default: T` means
        // the default is a VALUE OF the constraint shape, checked by ordinary
        // membership so the optional-key form (NumberBounds' `default = {}`)
        // survives, per P1f. The membership is judged over the SNAPSHOT, not
        // the live object: the snapshot is what every portion is built from,
        // so it is the artifact the rule protects, and judging it keeps a
        // getter on the default to exactly ONE read, at declaration - the
        // matrix's P1c caught the live-object check reading it a second time,
        // which the pre-Phase-4 probes structurally could not see (F46).
        const snapshot = Q(yield* SnapshotMetadataValue(v));
        if (!Q(yield* IsOfType(MetadataAsObject(snapshot), shape))) {
          return Throw.TypeError('the default of a meta type must be a value of its constraint shape');
        }
        RegisterMetaDefaultSnapshot(typeObject, snapshot);
      }
      sawDefault = true;
    } else {
      const hookName = (hook as { ClassElementName?: { name?: string } }).ClassElementName?.name;
      const body = (hook as { FunctionBody?: ParseNode.FunctionBody | null }).FunctionBody;
      const params = (hook as { UniqueFormalParameters?: ParseNode.FormalParameters }).UniqueFormalParameters;
      if (hookName === 'subtype') {
        sawSubtype = true;
      }
      if (typeof hookName === 'string' && body && params) {
        const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
        const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
        const fn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'meta hook', params, body, 'non-lexical-this', env, privEnv);
        RegisterMetaHook(typeObject, hookName, fn);
        RegisterMetaTypeName(typeObject as object, name);
      }
    }
  }
  // #sec-primitive-metadata: "it is an early error ... a missing `default` or
  // `subtype`". Both are required, and `subtype` is required for a reason the
  // brand makes plain: it is the meta type's half of the metadata subtype
  // judgment, so a meta type without one states no relation between two of its
  // parameterizations at all, and the crossing between them has nothing to
  // consult. `validate` stays optional, because a meta type that defines none
  // deliberately admits no bare value, which is what a brand is.
  if (!sawDefault) {
    return Throw.TypeError('$1 is not supported yet', Value(`a meta declaration for ${name} without a default hook`));
  }
  if (!sawSubtype) {
    return Throw.TypeError('a meta declaration requires a $1 hook', Value('subtype'));
  }
  return undefined;
}

/**
 * proposal-runtime-types M17: MemberExpression/CallExpression TypeArguments.
 * A generic alias Type Object specializes; any other base keeps its Reference
 * so member calls retain their this binding.
 */
/**
 * proposal-runtime-types: the constructor of an array type written in
 * expression position, one per interned type so that two mentions of
 * `[4].<uint8>` are one constructor.
 *
 * An instance is an ordinary Array carrying the element type, which is what a
 * typed array is everywhere else in this implementation - so the element store
 * check, the array methods, and `length` all work on one without a second kind
 * of object to teach them about. A fixed extent is filled with the element
 * type's default value, since `new [100].<uint8>()` is asking for a hundred of
 * them; a dynamic one starts empty and grows.
 */
const arrayTypeConstructors = new Map<unknown, ObjectValue>();

function* ArrayTypeConstructorFor(node: ParseNode.TypeArgumentsExpression): ValueEvaluator {
  const literal = node.Expression as unknown as ParseNode.ArrayLiteral;
  const elements = (literal.ElementList ?? []) as readonly ParseNode[];
  // `[]` is dynamic; `[N]` is a fixed extent. Anything else is not an array
  // type, so it keeps its reading as a literal with type arguments.
  let extent: number | 'dynamic' = 'dynamic';
  if (elements.length === 1) {
    const only = elements[0] as { type?: string, value?: unknown };
    if (only.type === 'NumericLiteral' && typeof only.value === 'number') {
      extent = only.value;
    } else {
      // An extent written over generic parameters - the design's `[W * H]` -
      // is an expression, evaluable once an application has bound them.
      const computed = Q(yield* GetValue(Q(yield* Evaluate(only as never))));
      const n = computed instanceof NumberValue
        ? Number((computed as unknown as { value: number }).value)
        : Number((computed as unknown as { value?: number }).value ?? NaN);
      if (!Number.isInteger(n) || n < 0) {
        return Throw.TypeError('$1 is not a type', Value('an array type needs a numeric extent or none'));
      }
      extent = n;
    }
  } else if (elements.length > 1) {
    return Throw.TypeError('$1 is not a type', Value('an array type needs a numeric extent or none'));
  }
  const args = node.TypeArguments.TypeArgumentList;
  const element = args.length > 0 ? Q(yield* TypeNodeToTypeRecord(args[0]!)) : anyType;
  const record = CanonicalizeType({ Kind: 'array', Element: element, Extent: extent } as never);
  // Keyed by the INTERNED Type Object rather than the record: canonicalizing
  // yields an equal record each time but not the same one, so a Map over
  // records never hit and `[4].<uint8>` gave a fresh constructor per mention.
  const key = GetTypeObject(record);
  const cached = arrayTypeConstructors.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const realm = surroundingAgent.currentRealmRecord;
  const ctor = CreateBuiltinFunction(markBuiltinFunctionAsConstructor(function* ArrayTypeConstructor(_args: readonly (Value | undefined)[], context: { NewTarget?: Value }): ValueEvaluator {
    const { NewTarget } = context;
    if (NewTarget === Value.undefined) {
      return Throw.TypeError('$1 requires new', Value(displayType(record as never)));
    }
    const length = extent === 'dynamic' ? 0 : extent;
    const array = X(ArrayCreate(length)) as ObjectValue & { TypedElement?: unknown };
    // A fixed extent is populated, since its elements exist from the start.
    if (extent !== 'dynamic') {
      const dflt = (Q(yield* DefaultValueOf(element as never)) ?? Value.undefined) as Value;
      for (let i = 0; i < length; i += 1) {
        X(CreateDataProperty(array, Value(String(i)), dflt));
      }
    }
    StampTypedArray(array as unknown as ObjectValue, element);
    // #sec-array-and-tuple-types: a fixed extent is part of the type, so a
    // constructed array carries it exactly as a converted one does - otherwise
    // `new [4].<float32>()` could be grown where `const a: [4].<float32>`
    // could not, and the same type would have two behaviours.
    if (extent !== 'dynamic') {
      (array as { TypedExtent?: number }).TypedExtent = extent;
    }
    // A subclass constructs through here with itself as NewTarget, so the
    // instance takes the subclass prototype and its methods.
    const proto = Q(yield* GetPrototypeFromConstructor(NewTarget as never, '%Array.prototype%'));
    X(array.SetPrototypeOf(proto));
    return array;
  }), 0, displayType(record as never), [], realm) as ObjectValue;
  // The prototype a subclass inherits from: array instances are Arrays, so the
  // methods come from %Array.prototype%.
  X(CreateDataProperty(ctor, Value('prototype'), realm.Intrinsics['%Array.prototype%']));
  // `[].<T>` in expression position evaluates to this CONSTRUCTOR, not to the
  // interned Type Object it was keyed on. So `isTypeObject` - which is
  // `'TypeRecord' in value` - answered false for it, and
  // `Reflect.getReflection([].<uint32>)` threw "is not a type" while every other
  // type reflected. Carrying the record here makes the constructor a Type Object
  // in its own right, which is the same shape the design already gives a class:
  // "a class's type object is its constructor".
  (ctor as unknown as { TypeRecord?: unknown }).TypeRecord = record;
  // README "Capacity": the static `[].<T>.withCapacity(n)` builds an EMPTY array
  // of T with room for at least n. It belongs here because this is the object
  // the design writes it on - an earlier attempt attached it at GetTypeObject,
  // which never sees an array type.
  const withCapacity = CreateBuiltinFunction(function* withCapacitySteps([wanted0 = Value.undefined]: Arguments): ValueEvaluator {
    // #sec-toindextype: a COUNT is checked as a count rather than coerced.
    // `reserve` refuses `a.reserve("4")` because its parameter is the index
    // type; `withCapacity` followed its clause's `ToLength` and accepted the
    // String, so the two operations that take a count disagreed about what one
    // is. Both clauses now say ToIndexType, and this is the second half.
    if (!isTypedNumber(wanted0 as Value) && !(wanted0 instanceof NumberValue)) {
      return Throw.TypeError('$1 is not assignable to $2', wanted0, Value('the index type'));
    }
    const wanted = Q(yield* ToNumber(wanted0));
    const n = Math.max(0, Math.trunc(Number(wanted.numberValue())));
    // #sec-array-type-withcapacity: the same ceiling `reserve` enforces. A
    // `[` `]` `.` `<` T `>` is an Array, so a capacity past (2 ** 32) - 1 is
    // room the array could never use. The clause specified this from the
    // start; the construction path did not perform it, so `withCapacity`
    // was the one way to obtain the unusable capacity `reserve` refuses.
    if (n > (2 ** 32) - 1) {
      // See `reserve`: specified but not reachable in this engine (#index-type).
      return Throw.TypeError('a count above the maximum array length is specified but not implemented in this engine');
    }
    const arr = X(ArrayCreate(0)) as unknown as ObjectValue & { TypedElement?: unknown, TypedCapacity?: number };
    StampTypedArray(arr as unknown as ObjectValue, element);
    arr.TypedCapacity = n;
    return arr;
  }, 1, Value('withCapacity'), []);
  X(CreateDataProperty(ctor as unknown as ObjectValue, Value('withCapacity'), withCapacity));
  // proposal-runtime-types #sec-instanceof-for-type-objects: "A Type Object has
  // a %Symbol.hasInstance% method. When called with argument v, it returns ?
  // IsOfType(v, the Type Object's [[TypeRecord]])."
  //
  // An array type in expression position is a CONSTRUCTOR, so it inherited
  // `Function.prototype[%Symbol.hasInstance%]` and answered by walking the
  // prototype chain instead. Every Array is an Array, so `x instanceof
  // [].<uint32>` was *true* for a plain untyped array, for an array of the
  // wrong element type, and for a fixed-extent array - while `is` answered
  // correctly in all three. Two membership operators disagreeing is the thing
  // the clause exists to prevent.
  const hasInstance = CreateBuiltinFunction(function* hasInstanceSteps([v = Value.undefined]: Arguments): ValueEvaluator {
    const member = Q(yield* IsOfType(v, record));
    return member ? Value.true : Value.false;
  }, 1, Value('[Symbol.hasInstance]'), []);
  X((ctor as unknown as ObjectValue).DefineOwnProperty(wellKnownSymbols.hasInstance, {
    Value: hasInstance as unknown as Value,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  } as never));
  arrayTypeConstructors.set(key, ctor);
  return ctor;
}

/**
 * A stable identity for one type argument. Interned Type Objects are one per
 * type, so an id per object distinguishes arguments that RENDER alike - `C.<4>`
 * and `C.<8>` both display as their base type, and keying on the rendering made
 * them one specialization.
 */
const specializationIds = new WeakMap<object, number>();
let nextSpecializationId = 0;
function specializationKeyOf(record: TypeRecord): string {
  const interned = GetTypeObject(record) as unknown as object;
  let id = specializationIds.get(interned);
  if (id === undefined) {
    id = nextSpecializationId;
    nextSpecializationId += 1;
    specializationIds.set(interned, id);
  }
  return String(id);
}

/** One specialization per declaration and argument list. */
const classSpecializations = new Map<unknown, Map<string, Value>>();

function* SpecializeGenericClass(declaration: ParseNode.ClassDeclaration, node: ParseNode.TypeArgumentsExpression): ValueEvaluator {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  const args = node.TypeArguments.TypeArgumentList;
  // #sec-generics: a trailing parameter with a default may be omitted, so a
  // class every one of whose parameters has a default may be applied with none.
  const firstDefault = params.findIndex((p) => (p as unknown as { TypeParameterDefault?: unknown }).TypeParameterDefault);
  const leastArgs = firstDefault === -1 ? params.length : firstDefault;
  if (args.length < leastArgs || args.length > params.length) {
    return Throw.TypeError('$1 takes $2 type arguments; $3 expects one taking $4', Value(declaration.BindingIdentifier?.name ?? 'a class'), Value(String(args.length)), Value('the declaration'), Value(String(params.length)));
  }
  const frame = new Map<string, TypeRecord>();
  const key: string[] = [];
  // The arguments the specialization's TYPE carries. A `B.<Identity>` used as
  // an annotation resolves to the nominal with these arguments, so the type of
  // an instance built from the specialization has to carry them too - without
  // them `const b: B.<Identity> = new B.<Identity>()` refused its own value.
  const argRecords: TypeRecord[] = [];
  for (let i = 0; i < params.length; i += 1) {
    const param = params[i] as unknown as {
      BindingIdentifier?: { name?: string },
      TypeParameterConstraint?: ParseNode.Type | null,
    };
    const name = param.BindingIdentifier?.name;
    // A parameter past the supplied arguments takes its default, resolved with
    // the frame built so far so that a default may name an earlier parameter.
    const argNode = i < args.length ? args[i]! : (param as { TypeParameterDefault?: ParseNode.Type | null }).TypeParameterDefault!;
    pushTypeParameterFrame(frame);
    let record;
    try {
      record = Q(yield* TypeNodeToTypeRecord(argNode));
    } finally {
      popTypeParameterFrame();
    }
    // #sec-type-parameters: a VALUE parameter's argument "is a value of the
    // named type", so the literal type it binds carries a value OF that type.
    // Without this `W: uint32` bound the plain number the argument was written
    // as, and a body mixing it with typed values - the design's `y * W + x`,
    // whose other operands are `uint32` - reported that the two numeric types
    // do not mix.
    if (record.Kind === 'literal' && param.TypeParameterConstraint) {
      const declared = Q(yield* TypeNodeToTypeRecord(param.TypeParameterConstraint));
      const converted = EnsureCompletion(yield* ConvertValue(record.Value as Value, declared as never));
      if (converted.Type === 'normal') {
        record = { ...record, Value: converted.Value as Value } as never;
      }
    }
    if (name) {
      frame.set(name, record);
    }
    key.push(specializationKeyOf(record));
    argRecords.push(record);
  }
  let byArgs = classSpecializations.get(declaration);
  if (byArgs === undefined) {
    byArgs = new Map();
    classSpecializations.set(declaration, byArgs);
  }
  const cacheKey = key.join(',');
  const cached = byArgs.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  pushTypeParameterFrame(frame);
  let specialized;
  try {
    const className = Value(declaration.BindingIdentifier?.name ?? '');
    specialized = EnsureCompletion(yield* ClassDefinitionEvaluation(
      declaration.ClassTail,
      className,
      className,
      '',
      [],
    ));
  } finally {
    popTypeParameterFrame();
  }
  if (specialized.Type !== 'normal') {
    return specialized as never;
  }
  const ctor = specialized.Value as Value;
  AssociateClassType(ctor, GetTypeObject({
    Kind: 'nominal', Declaration: declaration as never, Arguments: argRecords, Constructor: ctor,
  } as never));
  byArgs.set(cacheKey, ctor);
  return ctor;
}

/**
 * The Type Object a parameterized primitive family denotes when applied, or
 * *undefined* where the base does not name one.
 *
 * `builtinTypeRecord` already carries the rule this has to honour: its arm for
 * these families answers a record when arguments are present and *null* when
 * the name is bare, so the bare name cannot be produced here by construction.
 */
function* FamilyApplicationFor(node: ParseNode.TypeArgumentsExpression): PlainEvaluator<unknown> {
  const name = (node.Expression as unknown as { name?: string }).name;
  if (name !== 'int' && name !== 'uint' && name !== 'vector') {
    return undefined;
  }
  const args: (TypeRecord | number)[] = [];
  for (const argument of node.TypeArguments.TypeArgumentList ?? []) {
    const resolved = Q(yield* TypeNodeToTypeRecord(argument as ParseNode.Type));
    // Through the same reading type position uses: a numeric argument is a
    // WIDTH or a LANE COUNT, so `int.<8>` carries the number 8 rather than a
    // literal type of 8. Building the record with the literal type instead
    // produces a family record with no layout - it resolves, and then has no
    // byteLength and interns unequal to `int8`.
    args.push(toNumericArgument(resolved as TypeRecord));
  }
  const record = builtinTypeRecord(name, args);
  if (record === null) {
    return undefined;
  }
  return GetTypeObject(record);
}

export function* Evaluate_TypeArgumentsExpression(node: ParseNode.TypeArgumentsExpression): PlainEvaluator<unknown> {
  // proposal-runtime-types (README "Typed Arrays"): an ARRAY TYPE written in
  // expression position - `new [100].<uint8>()`, or `class G extends
  // [W * H].<uint8>` - denotes the type's constructor.
  //
  // The base of such an expression parses as an array LITERAL, since that is
  // what `[100]` is where an expression is expected, and its type arguments
  // were evaluated and discarded: `new [100].<uint8>()` reported "[object
  // Array] is not a constructor" and `extends [4].<uint8>` the same for its
  // superclass. Resolved here, before the base is evaluated as a literal,
  // because evaluating it is exactly the reading that has to be avoided.
  if (surroundingAgent.feature('runtime-types') && node.Expression.type === 'ArrayLiteral') {
    return Q(yield* ArrayTypeConstructorFor(node));
  }
  const ref = yield* Evaluate(node.Expression);
  const inspected = EnsureCompletion(ref);
  if (inspected.Type !== 'normal') {
    return ref;
  }
  const peeked = EnsureCompletion(yield* GetValue(inspected.Value as never));
  if (peeked.Type !== 'normal') {
    // proposal-runtime-types #sec-types-in-expression-position: "A type name is
    // already an expression, since a type is a value, so `uint8` and
    // `Map.<string, uint8>` may be written where a value is expected."
    //
    // A PARAMETERIZED PRIMITIVE FAMILY has no binding to evaluate - `int`,
    // `uint` and `vector` are types only when applied, and #sec-vector-widths
    // is explicit that "a bare parameterized primitive is not a value", so
    // binding them is not the fix. The application is resolved here instead,
    // where the reference has just failed to resolve, and only there: these are
    // ORDINARY IDENTIFIERS a program may bind -
    //
    //   let int = 5;        // legal, and keeps its meaning
    //   int.<8>             // only reaches this arm when nothing bound `int`
    //
    // so resolving before the lookup would shadow a working program. Confined
    // to the unresolvable case, this changes behaviour exactly where a
    // ReferenceError was thrown and nowhere else.
    if (surroundingAgent.feature('runtime-types') && node.Expression.type === 'IdentifierReference') {
      const familyType = Q(yield* FamilyApplicationFor(node));
      if (familyType !== undefined) {
        return familyType;
      }
    }
    return ref;
  }
  const value = peeked.Value;
  // proposal-runtime-types #sec-generics: applying arguments to a GENERIC CLASS
  // yields its specialization - "each distinct application is a distinct type
  // with its own Type Object and its own specialized body". The class is
  // evaluated again over the application's bindings, so its heritage clause and
  // every body in it read the parameters as this application bound them, and
  // two applications with the same arguments are one specialization.
  if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue) {
    const classType = LookupClassType(value as unknown as object);
    const declaration = classType && isTypeObject(classType) && classType.TypeRecord.Kind === 'nominal'
      ? classType.TypeRecord.Declaration as unknown as { type?: string, TypeParameters?: { TypeParameterList?: readonly unknown[] }, ClassTail?: unknown, BindingIdentifier?: { name?: string } }
      : undefined;
    const params = declaration?.TypeParameters?.TypeParameterList;
    // A HIGHER-KINDED parameter stands for a generic declaration rather than a
    // type (#sec-higher-kinded-parameters), so its argument is not resolvable
    // as one and specializing over it is not this path's business; the nominal
    // instantiation below carries such arguments as it always has.
    const kinded = params?.some((p) => ((p as { Arity?: number }).Arity ?? 0) > 0);
    if (params && params.length > 0 && declaration.ClassTail && !kinded) {
      return Q(yield* SpecializeGenericClass(declaration as never, node));
    }
  }
  if (isTypeObject(value)) {
    const record = value.TypeRecord;
    if (record.Kind === 'nominal' && record.Declaration.type === 'TypeAliasDeclaration' && (record.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
      const argRecords: TypeRecord[] = [];
      for (const argNode of node.TypeArguments.TypeArgumentList) {
        argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      const instantiated = Q(yield* InstantiateGenericAlias(record.Declaration as ParseNode.TypeAliasDeclaration, argRecords));
      return GetTypeObject(instantiated);
    }
    // proposal-runtime-types: everything that is NOT a generic alias fell
    // through to the unapplied base, so `Iterable.<uint8>` in expression
    // position evaluated to bare `Iterable` and `Iterable === Iterable.<uint8>`
    // was *true*. An alias worked, which is what made the gap hard to see: the
    // one shape with a handler behaved correctly and every other shape silently
    // discarded its arguments.
    const argRecords: TypeRecord[] = [];
    for (const argNode of node.TypeArguments.TypeArgumentList) {
      argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
    }
    // A built-in interface is rebuilt from its name, because its record carries
    // members rather than arguments and there is nothing to attach them to.
    const baseName = node.Expression.type === 'IdentifierReference'
      ? (node.Expression as unknown as { name: string }).name
      : undefined;
    if (baseName !== undefined) {
      const rebuilt = iterationInterfaceRecord(baseName, argRecords);
      if (rebuilt) {
        return GetTypeObject(rebuilt);
      }
    }
    // A nominal takes its arguments directly, which is what the annotation path
    // does for the same types.
    if (record.Kind === 'nominal') {
      return GetTypeObject(CanonicalizeType({ ...record, Arguments: argRecords }));
    }
  }
  return ref;
}

/** decorators.md's `EnumReflection` and `EnumEnumeratorReflection`. */
export function* EnumDecoratorContext(kind: string, name: Value, target: Value, extra?: { size?: number, index?: number, valueType?: Value }): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), name));
  // proposal-runtime-types #sec-reflection-shape-enum. An Enum reflection
  // reports the enum's `type`, the `valueType` its enumerators take their
  // values in, and its `size`. An ENUMERATOR reports its `value` and its
  // `index` and NO type - the type is the enum's, and repeating it per member
  // would be the same Type Object once per enumerator.
  if (kind === 'Enum') {
    X(CreateDataProperty(context, Value('type'), target));
    X(CreateDataProperty(context, Value('valueType'), extra?.valueType ?? Value.undefined));
    X(CreateDataProperty(context, Value('size'), extra?.size === undefined ? Value.undefined : Value(extra.size)));
  } else {
    const memberValue = name === Value.undefined ? Value.undefined : Q(yield* Get(target as ObjectValue, name as never));
    X(CreateDataProperty(context, Value('value'), memberValue));
    // Declaration order, which is not the value wherever a program assigns
    // values explicitly.
    X(CreateDataProperty(context, Value('index'), extra?.index === undefined ? Value.undefined : Value(extra.index)));
  }
  // The enum's own metadata under the empty member, an enumerator's under its
  // name - so `@f enum E { @g A }` gives two objects rather than one shared.
  const memberName = kind === 'Enum' ? '' : (name instanceof JSStringValueClass ? name.stringValue() : kind);
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(target, undefined, memberName)));
  return context;
}


/**
 * The number an enumerator continues from, or *undefined* where its value is not
 * numeric. A converted enumerator is a TypedNumberValue and an unconverted one a
 * NumberValue, and both carry the same reading.
 */
function NumericValueOfEnumerator(v: Value): number | undefined {
  const n = (v as unknown as { numberValue?: () => number }).numberValue;
  if (typeof n === 'function') {
    const read = n.call(v);
    return typeof read === 'number' ? read : undefined;
  }
  return v instanceof NumberValue ? (R(v) as number) : undefined;
}
