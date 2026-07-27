import { EnforceAnnotation } from '../abstract-ops/all.mts';
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
import { CreateRefBinding, RefBindingHolder, EnvironmentRecord } from '../execution-context/Environment.mts';
import { IsOfTypeNode } from '../abstract-ops/runtime-types.mts';
import { AddDisposableResource } from '../abstract-ops/disposal.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import { RequireBorrowableReference, SoAElementViewFor } from './RefExpression.mts';
import {
  surroundingAgent,
  GetValue,
  InitializeReferencedBinding,
  ResolveBinding,
  LookupTypeDefault,
  Throw,
} from '#self';

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
    const location = Q(yield* RequireBorrowableReference(Initializer as ParseNode.LeftHandSideExpression));
    // proposal-runtime-types soa.md: a `const ref p = s[i]` borrows the column
    // set and the index, not the gathered copy. This is the form the design
    // writes, so it is the one that matters most.
    const soaView = Q(yield* SoAElementViewFor(location));
    if (soaView !== undefined) {
      Q(yield* InitializeReferencedBinding(lhs, soaView));
      return NormalCompletion(undefined);
    }
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
      // a. Let rhs be the result of evaluating Initializer.
      const rhs = Q(yield* Evaluate(Initializer));
      // b. Let value be ? GetValue(rhs).
      value = Q(yield* GetValue(rhs));
    }
    // proposal-runtime-types: the annotation check at the binding boundary.
    value = Q(yield* EnforceAnnotation(TypeAnnotation, value));
    // 5. Return InitializeReferencedBinding(lhs, value).
    return yield* InitializeReferencedBinding(lhs, value);
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
        dflt = DefaultValueOf(record);
      }
      if (dflt !== undefined) {
        // The default crosses the same conversion boundary as an initializer.
        initial = Q(yield* EnforceAnnotation(TypeAnnotation, dflt));
      }
    }
    // 2. Return InitializeReferencedBinding(lhs, undefined).
    return yield* InitializeReferencedBinding(lhs, initial);
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
export function* Evaluate_LexicalDeclaration({ BindingList, LetOrConst }: ParseNode.LexicalDeclaration): PlainEvaluator {
  // proposal-runtime-types (explicit resource management): each binding of a
  // `using` declaration registers its value as a resource of the running
  // environment, to be disposed when that environment is left.
  if (LetOrConst === 'using') {
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
  // 3. Return NormalCompletion(empty).
  return undefined;
}
