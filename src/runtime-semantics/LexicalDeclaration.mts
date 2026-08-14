import { EnforceAnnotation } from '../abstract-ops/all.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { InitializerTokensOf } from './ClassDefinitionEvaluation.mts';
import { EnsureCompletion } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import {
  NormalCompletion, Q, X,
} from '../completion.mts';
import { Value } from '../value.mts';
import { IsAnonymousFunctionDefinition, StringValue, type FunctionDeclaration } from '../static-semantics/all.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { TypeNodeToTypeRecord, DefaultValueOf } from '../type-system/runtime.mts';
import { displayType } from '../type-system/records.mts';
import { CreateRefBinding, RefBindingHolder, EnvironmentRecord } from '../execution-context/Environment.mts';
import { IsOfTypeNode } from '../abstract-ops/runtime-types.mts';
import { AddDisposableResource } from '../abstract-ops/disposal.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import { RequireBorrowableReference, SoAElementLocationFor } from './RefExpression.mts';
import {
  surroundingAgent,
  GetValue,
  InitializeReferencedBinding,
  ResolveBinding,
  LookupTypeDefault,
  Throw,
  OrdinaryObjectCreate,
  CreateDataProperty,
} from '#self';
import { pushContextualType, popContextualType } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';

/** https://tc39.es/ecma262/#sec-let-and-const-declarations-runtime-semantics-evaluation */
//   LexicalBinding :
//     BindingIdentifier
//     BindingIdentifier Initializer
function* Evaluate_LexicalBinding_BindingIdentifier(node: ParseNode.LexicalBinding): PlainEvaluator {
  const {
    BindingIdentifier, Initializer, TypedInitializer, strict, TypeAnnotation,
  } = node;
  // proposal-runtime-types (references extension): a `ref` lexical binding, the
  // `let ref b = a[0]` / `const ref b = a[0]` form. The initializer denotes a
  // storage location rather than a value, and the binding aliases it: a read
  // dereferences and, for a `let ref`, a write writes through. A `const ref`
  // aliases the same location but is not writable through (a reassignment is the
  // ordinary assignment-to-constant error, while a member write through the
  // referent is allowed). The initializer must denote a location; a plain value
  // has nothing to borrow. An annotation is checked against the referent without
  // conversion, since a borrow never rewrites the storage it aliases.
  if (node.Ref === true) {
    const bindingId = StringValue(BindingIdentifier!);
    const lhs = X(ResolveBinding(bindingId, undefined, strict));
    const location = Q(yield* SoAElementLocationFor(Q(yield* RequireBorrowableReference(Initializer as ParseNode.LeftHandSideExpression))));
    // proposal-runtime-types soa.md: a `const ref p = s[i]` borrows the column
    // set and the index, not the gathered copy. The borrow is a LOCATION like
    // any other (#sec-soa-references), so it goes through the ref binding below
    // rather than binding a handle as an ordinary value - which is what makes
    // `f(ref s[i])` and `const ref p = s[i]` the same borrow.
    if (TypeAnnotation) {
      const referent = Q(yield* GetValue(location));
      const ok = Q(yield* IsOfTypeNode(referent, TypeAnnotation.Type));
      if (!ok) {
        return Throw.TypeError('the value bound by ref to $1 does not satisfy its type annotation', bindingId);
      }
    }
    const holder = lhs.Base instanceof EnvironmentRecord ? RefBindingHolder(lhs.Base, bindingId) : undefined;
    if (holder === undefined) {
      return Throw.TypeError('$1 cannot be bound by ref here', bindingId);
    }
    // The binding was created by BlockDeclarationInstantiation as mutable for a
    // `let` and immutable for a `const`; a `let ref` writes through and rebinds,
    // a `const ref` does neither. CreateRefBinding replaces the placeholder entry
    // in place, so the temporal dead zone up to this declaration is preserved.
    const mutable = holder.bindings.get(bindingId)?.mutable === true;
    CreateRefBinding(holder, bindingId, location, mutable);
    return NormalCompletion(undefined);
  }
  if (TypedInitializer) {
    // proposal-runtime-types: the typed-assignment declaration `let a := X`
    // (README "Typed Assignment"). The binding's type is inferred from X, which
    // already carries its own type (`:=` and casts produce typed values), so the
    // value is bound as-is with no separate annotation to enforce.
    const bindingId = StringValue(BindingIdentifier!);
    const lhs = X(ResolveBinding(bindingId, undefined, strict));
    const rhs = Q(yield* Evaluate(TypedInitializer.AssignmentExpression));
    const value = Q(yield* GetValue(rhs));
    return yield* InitializeReferencedBinding(lhs, value);
  }
  if (Initializer) {
    // 1. Let bindingId be StringValue of BindingIdentifier.
    const bindingId = StringValue(BindingIdentifier!);
    // 2. Let lhs be ResolveBinding(bindingId).
    const lhs = X(ResolveBinding(bindingId, undefined, strict));
    let value: Value;
    // 3. If IsAnonymousFunctionDefinition(Initializer) is true, then
    if (IsAnonymousFunctionDefinition(Initializer)) {
      // a. Let value be NamedEvaluation of Initializer with argument bindingId.
      value = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
    } else { // 4. Else,
      // proposal-runtime-types #sec-overloading-on-return-type: "the contextual
      // type of a call is the type its position requires". An annotated binding
      // is such a position, and the type has to be in scope WHILE the
      // initializer runs - the conversion that follows sees only the result, by
      // which point an overload has been chosen and possibly the wrong one has
      // run. Popped in a finally, so an abrupt initializer does not leave the
      // stack standing for the next evaluation.
      let contextual: TypeRecord | null = null;
      if (TypeAnnotation) {
        // A malformed annotation is the binding boundary's error to report, not
        // this one's, so a failure here simply leaves the call uncontextualized.
        const resolvedContext = yield* TypeNodeToTypeRecord(TypeAnnotation.Type);
        contextual = (resolvedContext as { Value?: TypeRecord })?.Value
          ?? (resolvedContext as TypeRecord | null) ?? null;
      }
      pushContextualType(contextual);
      let rhs;
      try {
        // a. Let rhs be the result of evaluating Initializer.
        rhs = Q(yield* Evaluate(Initializer));
      } finally {
        popContextualType();
      }
      // b. Let value be ? GetValue(rhs).
      value = Q(yield* GetValue(rhs));
    }
    // proposal-runtime-types: the annotation check at the binding boundary.
    value = Q(yield* EnforceAnnotation(TypeAnnotation, value));
    // 5. Return InitializeReferencedBinding(lhs, value).
    const initialized = Q(yield* InitializeReferencedBinding(lhs, value));
    if (TypeAnnotation) {
      recordDeclaredType(lhs, Q(yield* TypeNodeToTypeRecord(TypeAnnotation.Type)));
    }
    return initialized;
  } else {
    // 1. Let lhs be ResolveBinding(StringValue of BindingIdentifier).
    const lhs = yield* ResolveBinding(StringValue(BindingIdentifier!), undefined, strict);
    // proposal-runtime-types #sec-meta-hooks: an annotated binding without an
    // initializer takes the type's registered default.
    let initial: Value = Value.undefined;
    if (TypeAnnotation) {
      const record = Q(yield* TypeNodeToTypeRecord(TypeAnnotation.Type));
      // A registered meta-type default takes precedence (a user type may define
      // its own default); otherwise the type's structural default per
      // #sec-default-values (numeric 0, '', false, and so on).
      let dflt = LookupTypeDefault(GetTypeObject(record));
      if (dflt === undefined) {
        dflt = Q(yield* DefaultValueOf(record));
      }
      if (dflt !== undefined) {
        // The default crosses the same conversion boundary as an initializer.
        initial = Q(yield* EnforceAnnotation(TypeAnnotation, dflt));
      } else if (record.Kind !== 'parameter') {
      // #sec-defaultvalueof: "It is a type error to declare a binding or a field
      // with a type _t_ and no initializer when DefaultValueOf(_t_) is ~none~."
      // The engine held *undefined* instead, which is not a value of the type,
      // so the binding's own invariant was broken from the start.
      //
      // Checked HERE rather than in the checking pass, though the clause calls
      // it a type error. A registered meta `default` supplies a default for a
      // type that has no structural one, and those register when a
      // MetaDeclaration EVALUATES - check.mts says so where it defers the
      // unclaimed-key adjudication for the same reason, since a parameterization
      // written above its meta type is legal. A checking-pass test would
      // therefore refuse `type T = uint8 | string; meta T { default = "d"; }
      // let s: T;`, a program that works. Testing after both lookups have failed
      // makes the condition exactly the clause's, at the cost of not reaching a
      // declaration that never executes.
      //
      // A ~parameter~ is exempt: nothing is known about what an application will
      // bind, so a generic's field is checked at its specialization - which this
      // engine does not reach, since a specialized field's type is not
      // substituted at all (recorded in KNOWN-DIVERGENCES.md).
        return Throw.TypeError('$1 has no default value, so a declaration of it needs an initializer', Value(displayType(record)));
      }
    }
    // 2. Return InitializeReferencedBinding(lhs, undefined).
    const initialized = Q(yield* InitializeReferencedBinding(lhs, initial));
    if (TypeAnnotation) {
      recordDeclaredType(lhs, Q(yield* TypeNodeToTypeRecord(TypeAnnotation.Type)));
    }
    return initialized;
  }
}

/**
 * proposal-runtime-types #sec-typed-bindings: the annotation is "checked
 * against its initializer and against every later assignment", so the declared
 * type is recorded on the binding rather than discarded once the initializer
 * has crossed it. The store consults it, which is what a field, an object
 * member and an array element already do through the type recorded on the
 * object.
 *
 * A `const` records it too. Nothing can assign to one, so it changes no
 * behaviour there - but a binding's type is a property of the binding, and
 * making the record conditional on mutability would be a second rule to keep in
 * step with the first.
 */
export function recordDeclaredType(lhs: unknown, record: unknown): void {
  // ResolveBinding hands back a Reference Record, sometimes still inside a
  // normal completion, so both shapes are unwrapped here rather than at the two
  // call sites.
  const wrapped = lhs as { Value?: unknown, Base?: unknown, ReferencedName?: unknown };
  const reference = (wrapped.Base !== undefined ? wrapped : wrapped.Value) as {
    Base?: unknown, ReferencedName?: unknown,
  } | undefined;
  type BindingHolder = { bindings?: { get(n: unknown): { declaredType?: unknown } | undefined } };
  const resolved = reference?.Base as (BindingHolder & { DeclarativeRecord?: BindingHolder }) | undefined;
  // A `let` at the top level of a script resolves against the GLOBAL record,
  // which is a pair: the lexical declarations live in its inner declarative
  // record, and only the var-scoped names reach its object record. So the
  // binding is looked for there as well as directly - a function-scoped `let`
  // finds it on the first try.
  const binding = resolved?.bindings?.get(reference?.ReferencedName)
    ?? resolved?.DeclarativeRecord?.bindings?.get(reference?.ReferencedName);
  if (binding) {
    binding.declaredType = record;
  }
}

/** https://tc39.es/ecma262/#sec-let-and-const-declarations-runtime-semantics-evaluation */
//   LexicalBinding : BindingPattern Initializer
function* Evaluate_LexicalBinding_BindingPattern(LexicalBinding: ParseNode.LexicalBinding) {
  const { BindingPattern, Initializer } = LexicalBinding;
  const rhs = Q(yield* Evaluate(Initializer!));
  const value = Q(yield* GetValue(rhs));
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  return yield* BindingInitialization(BindingPattern!, value, env);
}

export function* Evaluate_LexicalBinding(LexicalBinding: ParseNode.LexicalBinding) {
  switch (true) {
    case !!LexicalBinding.BindingIdentifier:
      return yield* Evaluate_LexicalBinding_BindingIdentifier(LexicalBinding);
    case !!LexicalBinding.BindingPattern:
      return yield* Evaluate_LexicalBinding_BindingPattern(LexicalBinding);
    default:
      throw OutOfRange.nonExhaustive(LexicalBinding);
  }
}

/** https://tc39.es/ecma262/#sec-let-and-const-declarations-runtime-semantics-evaluation */
//   BindingList : BindingList `,` LexicalBinding
//
// (implicit)
//   BindingList : LexicalBinding
export function* Evaluate_BindingList(BindingList: ParseNode.BindingList) {
  // 1. Let next be the result of evaluating BindingList.
  // 3. Return the result of evaluating LexicalBinding.
  let next;
  for (const LexicalBinding of BindingList) {
    next = yield* Evaluate_LexicalBinding(LexicalBinding);
    Q(next);
  }
  return next;
}

/** https://tc39.es/ecma262/#sec-let-and-const-declarations-runtime-semantics-evaluation */
//   LexicalDeclaration : LetOrConst BindingList `;`
export function* Evaluate_LexicalDeclaration({ BindingList, LetOrConst, Decorators }: ParseNode.LexicalDeclaration): PlainEvaluator {
  // proposal-runtime-types decorators.md: `Let` and `Const` are the first
  // decorators on a STATEMENT rather than a member, and they fire when the
  // statement executes - "a decorator runs when its declaration is evaluated".
  // A binding's decorators therefore run AFTER its initializer, since that is
  // when the binding exists to be described.
  const applyBindingDecorators = function* applyBindingDecorators(): PlainEvaluator {
    if (!surroundingAgent.feature('runtime-types') || !Decorators?.length) {
      return NormalCompletion(undefined);
    }
    for (const binding of BindingList) {
      const id = (binding as { BindingIdentifier?: { name?: string } }).BindingIdentifier;
      if (typeof id?.name !== 'string') {
        continue;
      }
      const value = Q(yield* GetValue(Q(yield* ResolveBinding(Value(id.name)))));
      Q(yield* ApplyDecorators(Decorators, Q(yield* BindingDecoratorContext(
        LetOrConst === 'const' ? 'Const' : 'Let', Value(id.name), value, binding as ParseNode,
      ))));
    }
    return NormalCompletion(undefined);
  };
  // proposal-runtime-types (explicit resource management): each binding of a
  // `using` declaration registers its value as a resource of the running
  // environment, to be disposed when that environment is left.
  if (LetOrConst === 'using') {
    // A `using` declaration takes no decorator context of its own; decorators.md
    // names only Let and Const.
    const next = yield* Evaluate_BindingList(BindingList);
    Q(next);
    for (const binding of BindingList) {
      const name = (binding as { BindingIdentifier?: { name: string } }).BindingIdentifier;
      if (!name) {
        continue;
      }
      const ref = X(ResolveBinding(Value(name.name), undefined, false));
      const value = Q(yield* GetValue(ref));
      Q(yield* AddDisposableResource(surroundingAgent.runningExecutionContext.LexicalEnvironment, value));
    }
    return NormalCompletion(undefined);
  }
  // 1. Let next be the result of evaluating BindingList.
  Q(yield* Evaluate_BindingList(BindingList));
  Q(yield* applyBindingDecorators());
  // 3. Return NormalCompletion(empty).
  return undefined;
}

/** decorators.md's `LetReflection` / `ConstReflection`: `name`, `type`, `value`. */
export function* BindingDecoratorContext(kind: string, name: Value, value: Value, node?: ParseNode): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), name));
  // proposal-runtime-types #sec-reflection-shape-binding: a Let or Const
  // reflection reports its `type` and its `initializer` beside its `initial`.
  // It had neither, so a binding's decorator could see what the binding started
  // with and not what it was declared AS - which of the four fields is the one a
  // typed proposal exists to answer.
  const annotation = (node as { TypeAnnotation?: { Type?: ParseNode } } | undefined)?.TypeAnnotation;
  if (annotation?.Type) {
    const declared = EnsureCompletion(yield* TypeNodeToTypeRecord(annotation.Type as never));
    if (declared.Type === 'normal') {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(declared.Value as unknown as TypeRecord, realm) as Value));
    }
  }
  X(CreateDataProperty(context, Value('initializer'), InitializerTokensOf(node)));
  // decorators.md's LetReflection and ConstReflection name this `initial`, and
  // the name is the accurate one: a decorator sees the value the binding was
  // DECLARED with, not a live view - a `let` reassigned later still reports what
  // it started with, which `value` implied it would not.
  X(CreateDataProperty(context, Value('initial'), value));
  return context;
}
