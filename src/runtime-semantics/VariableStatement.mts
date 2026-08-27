import { GetTypeObject, NoDefaultValueError } from '../type-system/intern.mts';
import { TypeNodeToTypeRecord, DefaultValueOf } from '../type-system/runtime.mts';
import { surroundingAgent, LookupTypeDefault } from '#self';
import { recordDeclaredType } from './LexicalDeclaration.mts';
import {
  NormalCompletion, Q,
} from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { StringValue, IsAnonymousFunctionDefinition, type FunctionDeclaration } from '../static-semantics/all.mts';
import { Value } from '../value.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  EnforceAnnotation,
  GetValue,
  PutValue,
  ResolveBinding,
} from '#self';

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableDeclaration :
//     BindingIdentifier
//     BindingIdentifier Initializer
//     BindingPattern Initializer
function* Evaluate_VariableDeclaration({ BindingIdentifier, Initializer, TypedInitializer, BindingPattern, TypeAnnotation }: ParseNode.VariableDeclaration): PlainEvaluator {
  if (BindingIdentifier) {
    if (TypedInitializer) {
      // proposal-runtime-types: the typed-assignment declaration `var b := X`
      // (README "Typed Assignment"). X carries its own inferred type, so the
      // value is bound as-is.
      const bindingId = StringValue(BindingIdentifier);
      const lhs = Q(yield* ResolveBinding(bindingId, undefined, BindingIdentifier.strict));
      const rhs = Q(yield* Evaluate(TypedInitializer.AssignmentExpression));
      const value = Q(yield* GetValue(rhs));
      return Q(yield* PutValue(lhs, value));
    }
    if (!Initializer) {
      // proposal-runtime-types #sec-defaultvalueof answers "the value a binding
      // or a field of the type _t_ holds before it is assigned", and
      // #sec-declarations draws no distinction among the declaration forms - so
      // an annotated `var` takes its type's default exactly as a `let` does.
      // The early return meant it never consulted the annotation at all, and
      // `var v: uint8;` held *undefined* where `let v: uint8;` held 0.
      //
      // AT THE DECLARATION STATEMENT rather than at the hoisted binding's
      // creation. A `var` is created at function entry, so the two moments are
      // observable apart - a read before the declaration sees *undefined*
      // either way here, where placing it at creation would make that read 0.
      // The clause's "before it is assigned" is arguably the second reading,
      // but `let` cannot distinguish them (its binding is in the temporal dead
      // zone until the declaration runs), so the clause was written without
      // this case in view. This is where every other annotation in the
      // language takes effect, and the choice is recorded in the tests.
      if (TypeAnnotation && surroundingAgent.feature('runtime-types')) {
        const bindingId = StringValue(BindingIdentifier);
        const lhs = Q(yield* ResolveBinding(bindingId, undefined, BindingIdentifier.strict));
        const record = Q(yield* TypeNodeToTypeRecord(TypeAnnotation.Type));
        // A registered meta default takes precedence over the structural one,
        // as it does for a lexical declaration.
        let dflt = LookupTypeDefault(GetTypeObject(record));
        if (dflt === undefined) {
          dflt = Q(yield* DefaultValueOf(record));
        }
        if (dflt !== undefined) {
          const initial = Q(yield* EnforceAnnotation(TypeAnnotation, dflt));
          const put = Q(yield* PutValue(lhs, initial));
          recordDeclaredType(lhs, record);
          return put;
        }
        if (record.Kind !== 'parameter') {
          // "It is a type error to declare a binding or a field with a type _t_
          // and no initializer when DefaultValueOf(_t_) is ~none~." The refusal
          // follows the default, so `var u: uint8 | string;` stops being legal
          // exactly as `let u: uint8 | string;` already is.
          return NoDefaultValueError(record);
        }
      }
      // 1. Return NormalCompletion(empty).
      return NormalCompletion(undefined);
    }
    // 1. Let bindingId be StringValue of BindingIdentifier.
    const bindingId = StringValue(BindingIdentifier);
    // 2. Let lhs be ? ResolveBinding(bindingId).
    const lhs = Q(yield* ResolveBinding(bindingId, undefined, BindingIdentifier.strict));
    // 3. If IsAnonymousFunctionDefinition(Initializer) is true, then
    let value;
    if (IsAnonymousFunctionDefinition(Initializer)) {
      // a. Let value be NamedEvaluation of Initializer with argument bindingId.
      value = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
    } else { // 4. Else,
      // a. Let rhs be the result of evaluating Initializer.
      const rhs = Q(yield* Evaluate(Initializer));
      // b. Let value be ? GetValue(rhs).
      value = Q(yield* GetValue(rhs));
    }
    // The declared type is recorded on the binding so a later ASSIGNMENT crosses
    // it too - #sec-typed-bindings checks an annotation "against its initializer
    // and against every later assignment", and a `var` was getting only the
    // first. Without it `var v: uint8 = 1; v = a;` for an out-of-range `any`
    // stored the value, which is the invariant break a `let` no longer has.
    // proposal-runtime-types: the annotation check at the binding boundary.
    value = Q(yield* EnforceAnnotation(TypeAnnotation, value));
    // 5. Return ? PutValue(lhs, value).
    const put = Q(yield* PutValue(lhs, value));
    if (TypeAnnotation && surroundingAgent.feature('runtime-types')) {
      recordDeclaredType(lhs, Q(yield* TypeNodeToTypeRecord(TypeAnnotation.Type)));
    }
    return put;
  }
  // 1. Let rhs be the result of evaluating Initializer.
  const rhs = Q(yield* Evaluate(Initializer!));
  // 2. Let rval be ? GetValue(rhs).
  const rval = Q(yield* GetValue(rhs));
  // 3. Return the result of performing BindingInitialization for BindingPattern passing rval and undefined as arguments.
  return yield* BindingInitialization(BindingPattern!, rval, Value.undefined);
}

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableDeclarationList : VariableDeclarationList `,` VariableDeclaration
//
// (implicit)
//   VariableDeclarationList : VariableDeclaration
export function* Evaluate_VariableDeclarationList(VariableDeclarationList: ParseNode.VariableDeclarationList) {
  let next;
  for (const VariableDeclaration of VariableDeclarationList) {
    next = yield* Evaluate_VariableDeclaration(VariableDeclaration);
    Q(next);
  }
  return next;
}

/** https://tc39.es/ecma262/#sec-variable-statement-runtime-semantics-evaluation */
//   VariableStatement : `var` VariableDeclarationList `;`
export function* Evaluate_VariableStatement({ VariableDeclarationList }: ParseNode.VariableStatement): PlainEvaluator {
  const next = yield* Evaluate_VariableDeclarationList(VariableDeclarationList);
  Q(next);
  return NormalCompletion(undefined);
}
