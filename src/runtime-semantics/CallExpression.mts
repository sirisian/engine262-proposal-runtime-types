import { Value, ReferenceRecord, JSStringValue } from '../value.mts';
import { IsInTailPosition } from '../static-semantics/all.mts';
import { Q } from '../completion.mts';
import { functionTypeParameters } from '../abstract-ops/runtime-types.mts';
import { vectorConstantLane } from '../type-system/vector-ops.mts';
import { VectorValue } from '../value.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ObjectValue as ObjectValueClass } from '../value.mts';
import { ClassFieldReflection, TypeStructureReflection } from '../intrinsics/Reflect.mts';
import { CreateArrayView } from '../abstract-ops/array-view.mts';
import { CreateSoAView, SoAWithCapacity } from '../intrinsics/SoA.mts';
import { ToIndex } from '../abstract-ops/all.mts';
import { ToString } from '../abstract-ops/all.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { TypedJSONParse } from '../intrinsics/JSON.mts';
import { TypedRandom } from '../intrinsics/Math.mts';
import { X } from '../completion.mts';
import { CompositeFromShape } from '../intrinsics/Composite.mts';
import { MetadataObjectFor, MemberDeclarationOf, AllMemberDeclarationsOf } from './ClassDefinitionEvaluation.mts';
import { EvaluateCall, ArgumentListEvaluation } from './all.mts';
import { OrdinaryObjectCreate, CreateDataProperty, ArrayCreate } from '#self';
import { Throw as ThrowError } from '#self';
import {
  surroundingAgent,
  GetValue,
  Get,
  IsPropertyReference,
  PerformEval,
  SameValue,
} from '#self';
import { GetTypeObject } from '../type-system/intern.mts';

/** https://tc39.es/ecma262/#sec-function-calls-runtime-semantics-evaluation */
// CallExpression :
//   CoverCallExpressionAndAsyncArrowHead
//   CallExpression Arguments
export function* Evaluate_CallExpression(CallExpression: ParseNode.CallExpression): ValueEvaluator {
  // 1. Let expr be CoveredCallExpression of CoverCallExpressionAndAsyncArrowHead.
  const expr = CallExpression;
  // 2. Let memberExpr be the MemberExpression of expr.
  const memberExpr = expr.CallExpression;
  // 3. Let arguments be the Arguments of expr.
  const args = expr.Arguments;
  // 4. Let ref be the result of evaluating memberExpr.
  // proposal-runtime-types #sec-vector-lanes: `v.lane.<I>()` and
  // `v.withLane.<I>(value)`. The index is a compile-time constant, so it is a
  // TYPE argument and reaches this interception rather than the argument list -
  // which is what makes an out-of-range index a type error where `v[i]`'s is a
  // RangeError. That asymmetry is the reason the design gives both forms.
  //
  // Answered BEFORE the callee is evaluated. `a.lane` is not a property a
  // vector has - evaluating it reaches the member refusal - so the whole form
  // has to be recognized from the node rather than from a function value.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && ((memberExpr as unknown as { Expression?: { type?: string } }).Expression)?.type === 'MemberExpression') {
    const inner = (memberExpr as unknown as { Expression: unknown }).Expression as {
      MemberExpression: ParseNode.Expression,
      IdentifierName?: { name: string },
    };
    const methodName = inner.IdentifierName?.name;
    if (methodName === 'lane' || methodName === 'withLane') {
      const receiverRef = Q(yield* Evaluate(inner.MemberExpression));
      const receiver = Q(yield* GetValue(receiverRef));
      if (receiver.type === 'Vector') {
        const typeArgs = memberExpr.TypeArguments.TypeArgumentList;
        const argList = Q(yield* ArgumentListEvaluation(args));
        return Q(yield* vectorConstantLane(
          receiver as VectorValue,
          methodName,
          typeArgs as readonly ParseNode.Type[],
          argList as readonly Value[],
        ));
      }
    }
  }
  const ref = Q(yield* Evaluate(memberExpr));
  // 5. Let func be ? GetValue(ref).
  const func = Q(yield* GetValue(ref));
  // proposal-runtime-types #sec-higher-kinded-parameters: "A higher-kinded
  // parameter is bound only by explicit application. It is never inferred from
  // an argument's type."
  //
  // The check belongs HERE and not in inference, which is what two earlier
  // attempts got wrong. Inference cannot tell a supplied kinded parameter from
  // an unsupplied one, because the frame that would hold the explicit arguments
  // is what inference is being asked to produce - so a rule enforced there
  // refuses `g.<Identity, uint8>(1)` as readily as `g(1)`. At the call the
  // callee node is in hand, and whether a TypeArgumentsExpression rides on it
  // is exactly the question.
  if (surroundingAgent.feature('runtime-types') && memberExpr.type !== 'TypeArgumentsExpression') {
    const params = functionTypeParameters(func as never);
    const kinded = params?.find((p: ParseNode.TypeParameter) => ((p as unknown as { Arity?: number }).Arity ?? 0) > 0);
    if (kinded) {
      return Throw.TypeError(
        '$1 must be supplied by explicit application and is never inferred',
        Value(kinded.BindingIdentifier.name),
      );
    }
  }
  // proposal-runtime-types (serialization.md): `JSON.parse.<T>(text)` is the
  // typed parse. Its type argument rides on the callee, which is a
  // TypeArgumentsExpression, so it is intercepted here where both the callee node
  // and the resolved function are in hand. The type argument becomes a Type
  // Record and the validating, converting parse runs in place of the untyped
  // call. With the feature off this path is never taken and the call is ordinary.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && SameValue(func, surroundingAgent.intrinsic('%JSON.parse%'))) {
    const typeArgs = memberExpr.TypeArguments.TypeArgumentList;
    if (typeArgs.length === 1) {
      const typeRecord = Q(yield* TypeNodeToTypeRecord(typeArgs[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      const text = argList.length > 0 ? argList[0]! : Value.undefined;
      return Q(yield* TypedJSONParse(text, typeRecord));
    }
  }
  // proposal-runtime-types soa.md: `SoA.withCapacity.<T>(n)` � "Empty, capacity
  // >= n". Its element type is a TYPE argument rather than inferred, because
  // there is no value to infer it from, so the call is intercepted where the
  // type arguments are in scope.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const inner = (memberExpr as unknown as { Expression?: { type?: string, MemberExpression?: { name?: string }, IdentifierName?: { name?: string } } }).Expression;
    if (inner?.type === 'MemberExpression'
        && inner.MemberExpression?.name === 'SoA'
        && inner.IdentifierName?.name === 'withCapacity') {
      const element = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      const n = argList.length > 0 ? Number(Q(yield* ToIndex(argList[0]!))) : 0;
      return Q(yield* SoAWithCapacity(element, n));
    }
  }
  // proposal-runtime-types soa.md, "Views": `SoA.<T, N>(buffer, byteOffset)` is
  // a call on the type, as the array view is, and for the same reason: nothing
  // is constructed, the bytes are already there.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && (memberExpr as unknown as { Expression?: { type?: string, name?: string } }).Expression?.type === 'IdentifierReference'
      && (memberExpr as unknown as { Expression: { name?: string } }).Expression.name === 'SoA') {
    const typeArgs = memberExpr.TypeArguments.TypeArgumentList;
    const element = Q(yield* TypeNodeToTypeRecord(typeArgs[0]!));
    let extent = 0;
    if (typeArgs.length > 1) {
      const second = Q(yield* TypeNodeToTypeRecord(typeArgs[1]!));
      if (second.Kind === 'literal' && typeof (second.Value as unknown as { value?: unknown })?.value === 'number') {
        extent = Number((second.Value as unknown as { value: number }).value);
      }
    }
    const argList = Q(yield* ArgumentListEvaluation(args));
    return Q(yield* CreateSoAView(element, extent, argList as unknown as readonly Value[]));
  }
  // proposal-runtime-types (README, "Views"): `[].<T>(buffer, byteOffset,
  // byteElementLength)` and `[N].<T>(...)` are VIEWS over bytes that already
  // exist. The form parses as an ARRAY LITERAL carrying type arguments and then
  // called, which is why it is intercepted here beside the other typed calls
  // rather than by making a Type Object callable.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && (memberExpr as unknown as { Expression?: { type?: string, ElementList?: readonly unknown[] } }).Expression?.type === 'ArrayLiteral'
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const literal = (memberExpr as unknown as { Expression: { ElementList?: readonly ParseNode[] } }).Expression;
    const elements = literal.ElementList ?? [];
    // `[].<T>` is length-tracking and `[N].<T>` is fixed, so the literal's one
    // element - when it has one - is the extent.
    let extent: number | 'dynamic' = 'dynamic';
    if (elements.length === 1) {
      const only = elements[0] as { type?: string, value?: unknown };
      if (only.type === 'NumericLiteral' && typeof only.value === 'number') {
        extent = only.value;
      } else {
        extent = -1;
      }
    } else if (elements.length > 1) {
      extent = -1;
    }
    if (extent !== -1) {
      const element = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      if (argList.length > 0) {
        return Q(yield* CreateArrayView(element, extent, argList as unknown as readonly Value[]));
      }
    }
  }
  // proposal-runtime-types #sec-layout-properties: `Reflect.getReflection.<`
  // `Reflect.ClassField`, T`>(`name`)` reports a field's `offset` and
  // `byteLength`. The context and the type ride on the callee as type
  // arguments, exactly as `JSON.parse.<T>`'s does, so the interception is the
  // same shape - which is why this sits beside it rather than inside
  // getReflection, where the type arguments are not in scope.
  // proposal-runtime-types `sec-composite-typeobject-call`: the TYPED creation
  // `Composite.<T>(source)`. The clause frames it as CALLING THE TYPE OBJECT of
  // the composite type - "the construction boundary a parameterized type
  // already has" - but `Composite` is a FUNCTION here, so `Composite.<T>` is
  // type arguments applied to it and the call is intercepted where the other
  // typed builtins are. The operation performed is the clause's either way.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const compositeFn = surroundingAgent.currentRealmRecord.Intrinsics['%Composite%'];
    if (compositeFn !== undefined && SameValue(func, compositeFn)) {
      const shape = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const argList = Q(yield* ArgumentListEvaluation(args));
      return Q(yield* CompositeFromShape(shape, argList.length > 0 ? argList[0]! : Value.undefined));
    }
  }
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && memberExpr.TypeArguments.TypeArgumentList.length === 2) {
    const reflectObj = surroundingAgent.intrinsic('%Reflect%');
    const getReflection = Q(yield* Get(reflectObj, Value('getReflection')));
    if (SameValue(func, getReflection)) {
      const contextRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      // #sec-reflection-contexts: `Reflect.getReflection.<Reflect.Type, T>()`
      // reflects T's own structure. The reflection itself is the one
      // `Reflect.getReflection(`_T_`)` already produces over a type object; this
      // is the CONTEXT form of the same request, which is how the specification
      // writes it and how every other context is asked for.
      if (contextRecord.Kind === 'nominal' && contextRecord.LibraryName === 'Reflect.Type') {
        const subject = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
        return Q(TypeStructureReflection(subject, surroundingAgent.currentRealmRecord));
      }
      // decorators.md's `ClassReflection`: `name`, `type`, `abstract`,
      // `metadata`. The whole-class read every other class-family read hangs
      // off, and the first of the thirty-nine contexts that answered nothing.
      if (contextRecord.Kind === 'nominal' && contextRecord.LibraryName === 'Reflect.Class') {
        const classRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
        const constructor = (classRecord as { Constructor?: Value }).Constructor;
        if (constructor === undefined) {
          return ThrowError.TypeError('$1 is not a class type', Value('the target of Reflect.getReflection'));
        }
        const realm = surroundingAgent.currentRealmRecord;
        const reflection = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(reflection, Value('kind'), Value('Class')));
        X(CreateDataProperty(reflection, Value('name'), Q(yield* Get(constructor as ObjectValueClass, Value('name')))));
        X(CreateDataProperty(reflection, Value('type'), constructor));
        // `abstract` is read from the constructor rather than re-derived: an
        // abstract class is refused at `new`, and the flag that does the
        // refusing is the same fact this reports.
        X(CreateDataProperty(reflection, Value('abstract'),
          (constructor as { IsAbstract?: boolean }).IsAbstract === true ? Value.true : Value.false));
        const base = constructor instanceof ObjectValueClass ? Q(yield* constructor.GetPrototypeOf()) : Value.undefined;
        X(CreateDataProperty(reflection, Value('metadata'), MetadataObjectFor(constructor, base)));
        return reflection;
      }
      // The class-family MEMBER reads. Each is one lookup in the declaration
      // record the class walk fills, plus the per-declaration metadata - the
      // context decides the reflection's TYPE and the name decides which
      // member, exactly as `getMetadata` does. Inherited members are included,
      // which decorators.md makes the default, by walking the base chain.
      const memberRead = contextRecord.Kind === 'nominal'
        && typeof contextRecord.LibraryName === 'string'
        && ['Reflect.ClassMethod', 'Reflect.ClassGetter', 'Reflect.ClassSetter',
          'Reflect.ClassAccessor', 'Reflect.ClassOperator'].includes(contextRecord.LibraryName);
      if (memberRead) {
        const classRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
        const constructor = (classRecord as { Constructor?: Value }).Constructor;
        if (constructor === undefined) {
          return ThrowError.TypeError('$1 is not a class type', Value('the target of Reflect.getReflection'));
        }
        const argList = Q(yield* ArgumentListEvaluation(args));
        const nameValue = argList.length > 0 ? argList[0]! : Value.undefined;
        // THE ENUMERATING FORM: no name, or `{ own: true }`. It returns
        // "{ [name]: Reflection }" - an object keyed by member name, which is
        // the shape decorators.md's signature gives - and includes inherited
        // members unless `own` says otherwise.
        if (nameValue === Value.undefined || nameValue instanceof ObjectValueClass) {
          let own = false;
          if (nameValue instanceof ObjectValueClass) {
            own = Q(yield* Get(nameValue, Value('own'))) === Value.true;
          }
          const kindName = (contextRecord.LibraryName as string).slice('Reflect.'.length);
          const all = AllMemberDeclarationsOf(constructor, kindName, own);
          const realm = surroundingAgent.currentRealmRecord;
          const collection = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
          const base0 = constructor instanceof ObjectValueClass ? Q(yield* constructor.GetPrototypeOf()) : Value.undefined;
          for (const [name, declaration] of all) {
            const one = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
            X(CreateDataProperty(one, Value('kind'), Value(declaration.kind)));
            X(CreateDataProperty(one, Value('name'), Value(name)));
            X(CreateDataProperty(one, Value('static'), declaration.static ? Value.true : Value.false));
            X(CreateDataProperty(one, Value('private'), declaration.private ? Value.true : Value.false));
            X(CreateDataProperty(one, Value('protected'), declaration.protected ? Value.true : Value.false));
            X(CreateDataProperty(one, Value('abstract'), declaration.abstract ? Value.true : Value.false));
            X(CreateDataProperty(one, Value('metadata'), MetadataObjectFor(constructor, base0, name)));
            X(CreateDataProperty(collection, Value(name), one));
          }
          return collection;
        }
        const memberName = Q(yield* ToString(nameValue));
        const declaration = MemberDeclarationOf(constructor, memberName.stringValue());
        if (declaration === undefined) {
          return ThrowError.TypeError('$1 is not a member of this type', memberName);
        }
        const realm = surroundingAgent.currentRealmRecord;
        const reflection = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(reflection, Value('kind'), Value(declaration.kind)));
        X(CreateDataProperty(reflection, Value('name'), memberName));
        X(CreateDataProperty(reflection, Value('static'), declaration.static ? Value.true : Value.false));
        X(CreateDataProperty(reflection, Value('private'), declaration.private ? Value.true : Value.false));
        X(CreateDataProperty(reflection, Value('protected'), declaration.protected ? Value.true : Value.false));
        X(CreateDataProperty(reflection, Value('abstract'), declaration.abstract ? Value.true : Value.false));
        // decorators.md gives a member reflection its `type` - the FUNCTION type
        // for a method, getter or setter. The read path had none while the
        // DECORATOR CONTEXT did, so two reflections of one declaration
        // disagreed. Both now read the same recorded type.
        if (declaration.type) {
          X(CreateDataProperty(reflection, Value('type'), GetTypeObject(declaration.type, surroundingAgent.currentRealmRecord) as Value));
        }
        const base = constructor instanceof ObjectValueClass ? Q(yield* constructor.GetPrototypeOf()) : Value.undefined;
        X(CreateDataProperty(reflection, Value('metadata'), MetadataObjectFor(constructor, base, memberName.stringValue())));
        return reflection;
      }
      if (contextRecord.Kind === 'nominal' && contextRecord.LibraryName === 'Reflect.ClassField') {
        const classRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
        const argList = Q(yield* ArgumentListEvaluation(args));
        const nameValue = argList.length > 0 ? argList[0]! : Value.undefined;
        const name = Q(yield* ToString(nameValue));
        return Q(ClassFieldReflection(classRecord, name.stringValue(), surroundingAgent.currentRealmRecord));
      }
    }
    // decorators.md: `getReflectionByIndex.<`Context`, `T`>(`member`)` returns
    // a member's parameters INDEXED BY POSITION - a list, not a name-keyed
    // object, which is what separates it from the enumerating forms.
    const getByIndex = Q(yield* Get(reflectObj, Value('getReflectionByIndex')));
    if (SameValue(func, getByIndex)) {
      const contextRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const targetRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
      const constructor = (targetRecord as { Constructor?: Value }).Constructor;
      const isParameterContext = contextRecord.Kind === 'nominal'
        && typeof contextRecord.LibraryName === 'string'
        && contextRecord.LibraryName.endsWith('Parameter');
      if (!isParameterContext) {
        return ThrowError.TypeError('$1 requires a reflection context as a type argument', Value('Reflect.getReflectionByIndex'));
      }
      if (constructor === undefined) {
        return ThrowError.TypeError('$1 is not a class type', Value('the target of Reflect.getReflectionByIndex'));
      }
      const argList = Q(yield* ArgumentListEvaluation(args));
      const memberValue = argList.length > 0 ? argList[0]! : Value.undefined;
      const memberName = Q(yield* ToString(memberValue));
      const declaration = MemberDeclarationOf(constructor, memberName.stringValue());
      if (declaration === undefined) {
        return ThrowError.TypeError('$1 is not a member of this type', memberName);
      }
      const realm = surroundingAgent.currentRealmRecord;
      const list = Q(ArrayCreate(0));
      const base1 = constructor instanceof ObjectValueClass ? Q(yield* constructor.GetPrototypeOf()) : Value.undefined;
      for (const parameter of declaration.parameters) {
        const one = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
        X(CreateDataProperty(one, Value('kind'), Value(contextRecord.LibraryName.slice('Reflect.'.length))));
        X(CreateDataProperty(one, Value('name'), Value(parameter.name)));
        X(CreateDataProperty(one, Value('index'), Value(parameter.index)));
        // `initial` is the DECLARED default, and a parameter's default is an
        // expression evaluated per call - so what is reported is whether one
        // was written, not a value. Same reason a field's `initial` is the
        // declared default rather than a per-instance one.
        X(CreateDataProperty(one, Value('hasDefault'), parameter.hasDefault ? Value.true : Value.false));
        X(CreateDataProperty(one, Value('metadata'),
          MetadataObjectFor(constructor, base1, `${memberName.stringValue()}:${parameter.index}`)));
        X(CreateDataProperty(list, Value(String(parameter.index)), one));
      }
      X(CreateDataProperty(list, Value('length'), Value(declaration.parameters.length)));
      return list;
    }
    // decorators.md: `Reflect.getMetadata.<`Context`, `T`>()` reads back what a
    // decorator wrote. THE SAME OBJECT, not a copy - metadata is a channel, and
    // a reader handed a copy would not see what a later decorator added.
    const getMetadata = Q(yield* Get(reflectObj, Value('getMetadata')));
    if (SameValue(func, getMetadata)) {
      const contextRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const targetRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[1]));
      const constructor = (targetRecord as { Constructor?: Value }).Constructor;
      if (constructor === undefined) {
        return ThrowError.TypeError('$1 is not a class type', Value('the target of Reflect.getMetadata'));
      }
      const base: Value = constructor instanceof ObjectValueClass ? Q(yield* constructor.GetPrototypeOf()) : Value.undefined;
      if (contextRecord.Kind === 'nominal' && contextRecord.LibraryName === 'Reflect.Class') {
        return MetadataObjectFor(constructor, base);
      }
      // EVERY class-family MEMBER context reads the same per-declaration store,
      // because a declaration is a field or a method or an accessor and never
      // two of them: the context decides the metadata's TYPE, and the name
      // decides which object. So `ClassMethod`, `ClassAccessor`, `ClassGetter`,
      // `ClassSetter` and `ClassOperator` need no cases of their own.
      const memberContext = contextRecord.Kind === 'nominal'
        && typeof contextRecord.LibraryName === 'string'
        && contextRecord.LibraryName.startsWith('Reflect.Class')
        && contextRecord.LibraryName !== 'Reflect.Class';
      if (memberContext) {
        const argList = Q(yield* ArgumentListEvaluation(args));
        const nameValue = argList.length > 0 ? argList[0]! : Value.undefined;
        const name = Q(yield* ToString(nameValue));
        return MetadataObjectFor(constructor, base, name.stringValue());
      }
      return ThrowError.TypeError('$1 requires a reflection context as a type argument', Value('Reflect.getMetadata'));
    }
  }
  // proposal-runtime-types (random.md): the no-argument typed form
  // `Math.random.<T>()`, whose type argument likewise rides on the callee. Only
  // the zero-argument form is intercepted here; the array-fill and range
  // overloads and a second (PRNG method) type argument fall through to the
  // ordinary call. TypedRandom returns undefined for a type it does not produce
  // (a plain number, a bigint, a wide integer), so that call is ordinary too.
  if (surroundingAgent.feature('runtime-types')
      && memberExpr.type === 'TypeArgumentsExpression'
      && args.length === 0
      && memberExpr.TypeArguments.TypeArgumentList.length === 1) {
    const mathRandom = Q(yield* Get(surroundingAgent.intrinsic('%Math%'), Value('random')));
    if (SameValue(func, mathRandom)) {
      const typeRecord = Q(yield* TypeNodeToTypeRecord(memberExpr.TypeArguments.TypeArgumentList[0]));
      const produced = TypedRandom(typeRecord, surroundingAgent.currentRealmRecord);
      if (produced !== undefined) {
        return produced;
      }
    }
  }
  // 6. If Type(ref) is Reference, IsPropertyReference(ref) is false, and GetReferencedName(ref) is "eval", then
  if (ref instanceof ReferenceRecord
      && IsPropertyReference(ref) === Value.false
      && (ref.ReferencedName instanceof JSStringValue
      && ref.ReferencedName.stringValue() === 'eval')) {
    // a. If SameValue(func, %eval%) is true, then
    if (SameValue(func, surroundingAgent.intrinsic('%eval%'))) {
      // i. Let argList be ? ArgumentListEvaluation of arguments.
      const argList = Q(yield* ArgumentListEvaluation(args));
      // ii. If argList has no elements, return undefined.
      if (argList.length === 0) {
        return Value.undefined;
      }
      // iii. Let evalText be the first element of argList.
      const evalText = argList[0]!;
      // iv. If the source code matching this CallExpression is strict mode code, let strictCaller be true. Otherwise let strictCaller be false.
      const strictCaller = CallExpression.strict;
      // vi. Return ? PerformEval(evalText, strictCaller, true).
      return Q(yield* PerformEval(evalText, strictCaller, true));
    }
  }
  // 7. Let thisCall be this CallExpression.
  const thisCall = CallExpression;
  // 8. Let tailCall be IsInTailPosition(thisCall).
  const tailCall = IsInTailPosition(thisCall);
  // 9. Return ? EvaluateCall(func, ref, arguments, tailCall).
  return Q(yield* EvaluateCall(func, ref, args, tailCall, CallExpression));
}
