import { Value, ReferenceValue } from '../value.mts';
import {
  EnsureCompletion,
  NormalCompletion,
  Q, X,
} from '../completion.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import {
  StringValue,
  IsAnonymousFunctionDefinition,
  HasInitializer,
} from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { __ts_cast__ } from '../utils/language.mts';
import { CreateRefBinding, DeclarativeEnvironmentRecord } from '../execution-context/Environment.mts';
import { IsOfTypeNode } from '../abstract-ops/runtime-types.mts';
import { CreateListIteratorRecord } from '../abstract-ops/iterator-operations.mts';
import { IsOfType, TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { restElementType } from '../type-system/records.mts';
import { SequenceAssignment } from '../type-system/sequence-assignment.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  Assert,
  GetValue,
  InitializeReferencedBinding,
  IteratorStep,
  PutValue,
  ResolveBinding,
  ArrayCreate,
  CreateDataPropertyOrThrow,
  ToString,
  F,
  type IteratorRecord,

  IteratorStepValue,
  UndefinedValue, type EnvironmentRecord, type FunctionDeclaration,
  Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-iteratorbindinginitialization */
// FormalParameters :
//   [empty]
//   FormalParameterList `,` FunctionRestParameter
export function* IteratorBindingInitialization_FormalParameters(FormalParameters: ParseNode.FormalParameters, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  if (FormalParameters.length === 0) {
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }

  // proposal-runtime-types, PLAN-rest-parameters.md phase 4c. A rest away from
  // the end, or more than one, has no meaning to the streaming walk below: it
  // binds each parameter in turn from the argument iterator, and a rest that is
  // not last would take one argument like any other parameter. Which run each
  // rest receives is SequenceAssignment's answer, and reaching it needs the
  // arguments in hand rather than an iterator, so that path materializes them.
  //
  // The base language's shape - at most one rest, and last - takes the walk
  // unchanged and never reaches the assignment. That is deliberate: this is the
  // hottest path in the engine, and it is the one place in this feature where a
  // mistake MISBINDS a program rather than rejecting it.
  const restCount = FormalParameters.filter((p) => p.type === 'BindingRestElement').length;
  const restIsLast = FormalParameters[FormalParameters.length - 1].type === 'BindingRestElement';
  if (restCount > 1 || (restCount === 1 && !restIsLast)) {
    return yield* IteratorBindingInitialization_AssignedParameters(FormalParameters, iteratorRecord, environment);
  }

  for (const FormalParameter of FormalParameters.slice(0, -1)) {
    Q(yield* IteratorBindingInitialization_FormalParameter(FormalParameter, iteratorRecord, environment));
  }

  const last = FormalParameters[FormalParameters.length - 1];
  if (last.type === 'BindingRestElement') {
    return yield* IteratorBindingInitialization_FunctionRestParameter(last, iteratorRecord, environment);
  }
  return yield* IteratorBindingInitialization_FormalParameter(last, iteratorRecord, environment);
}

/**
 * Bind a parameter list whose rests are not simply trailing.
 *
 * The arguments are drained from the iterator, assigned to the parameters by
 * SequenceAssignment over their RUN-TIME types, and each parameter is then bound
 * from a fresh iterator over the run it received. Binding through the ordinary
 * per-parameter operations is what keeps defaults, destructuring patterns, `ref`
 * borrowing, and the annotation checks working exactly as they do elsewhere.
 *
 * The predicate is the run-time type test rather than the checker's static one,
 * which is what a call arriving through `any`, `apply`, or a spread of unknown
 * length needs; for a call the checker has already accepted, the two agree.
 */
function* IteratorBindingInitialization_AssignedParameters(FormalParameters: ParseNode.FormalParameters, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  const args: Value[] = [];
  while (iteratorRecord.Done === Value.false) {
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next === 'done') {
      break;
    }
    args.push(next);
  }
  // A parameter admits an argument when it is of the parameter's declared type,
  // its ELEMENT type where the parameter is a rest, since that is what one
  // argument reaching it must be. An unannotated parameter admits anything.
  const admitted: boolean[][] = [];
  for (const arg of args) {
    const row: boolean[] = [];
    for (const p of FormalParameters) {
      const annotation = (p as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
      if (!annotation) {
        row.push(true);
        continue;
      }
      // The assignment is a DISTRIBUTION, not the enforcement: each parameter's
      // own annotation check runs when it is bound, below, and rejects what
      // does not fit. So a type this cannot resolve - a generic parameter whose
      // substitution is not in scope here, which `...a: [].<T>` is - admits
      // rather than throwing, and the distribution falls back to positions
      // while the enforcement stays exact.
      const resolved = EnsureCompletion(yield* TypeNodeToTypeRecord(annotation.Type));
      if (resolved.Type === 'throw') {
        row.push(true);
        continue;
      }
      const declared = resolved.Value;
      const wanted = p.type === 'BindingRestElement' ? restElementType(declared) : declared;
      row.push(Q(yield* IsOfType(arg, wanted)));
    }
    admitted.push(row);
  }
  const slots = FormalParameters.map((p) => ({
    Rest: p.type === 'BindingRestElement',
    Optional: HasInitializer(p as ParseNode.FormalParameter),
  }));
  const counts = SequenceAssignment(slots, args.length, (i, k) => admitted[i][k]);
  if (counts === 'unmatched') {
    return Throw.TypeError('no assignment of the arguments satisfies the parameter list');
  }
  let at = 0;
  for (let k = 0; k < FormalParameters.length; k += 1) {
    const run = args.slice(at, at + counts[k]);
    at += counts[k];
    const runIterator = CreateListIteratorRecord(run);
    const p = FormalParameters[k];
    if (p.type === 'BindingRestElement') {
      Q(yield* IteratorBindingInitialization_FunctionRestParameter(p, runIterator, environment));
    } else {
      Q(yield* IteratorBindingInitialization_FormalParameter(p, runIterator, environment));
    }
  }
  return NormalCompletion(undefined);
}

// FormalParameter : BindingElement
function IteratorBindingInitialization_FormalParameter(BindingElement: ParseNode.FormalParametersElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  // TODO
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return IteratorBindingInitialization_BindingElement(BindingElement as any, iteratorRecord, environment);
}

// FunctionRestParameter : BindingRestElement
function IteratorBindingInitialization_FunctionRestParameter(FunctionRestParameter: ParseNode.FunctionRestParameter, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  return IteratorBindingInitialization_BindingRestElement(FunctionRestParameter, iteratorRecord, environment);
}

// BindingElement :
//   SingleNameBinding
//   BindingPattern
function IteratorBindingInitialization_BindingElement(BindingElement: ParseNode.BindingElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  if ('BindingPattern' in BindingElement) {
    return IteratorBindingInitialization_BindingPattern(BindingElement, iteratorRecord, environment);
  }
  return IteratorBindingInitialization_SingleNameBinding(BindingElement, iteratorRecord, environment);
}

// SingleNameBinding : BindingIdentifier Initializer?
function* IteratorBindingInitialization_SingleNameBinding(node: ParseNode.SingleNameBinding, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue): PlainEvaluator {
  const { BindingIdentifier, Initializer } = node;
  // 1. Let bindingId be StringValue of BindingIdentifier.
  const bindingId = StringValue(BindingIdentifier);
  // 2. Let lhs be ? ResolveBinding(bindingId, environment).
  const lhs = Q(yield* ResolveBinding(bindingId, environment, BindingIdentifier.strict));
  let v: Value = Value.undefined;
  // 3. If iteratorRecord.[[Done]] is false, then
  if (iteratorRecord.Done === Value.false) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // d. If next is not DONE,
    if (next !== 'done') {
      v = next;
    }
  }
  // 5. If Initializer is present and v is undefined, then
  if (Initializer && v === Value.undefined) {
    if (IsAnonymousFunctionDefinition(Initializer)) {
      v = Q(yield* NamedEvaluation(Initializer as FunctionDeclaration, bindingId));
    } else {
      const defaultValue = Q(yield* Evaluate(Initializer));
      v = Q(yield* GetValue(defaultValue));
    }
  }
  // proposal-runtime-types (references extension): a `ref` parameter binds an
  // alias to the caller's storage location, so a read in the callee reads the
  // referent and a write writes through. It requires a `ref` argument, since a
  // plain value has no location to borrow. An annotation on a ref parameter is
  // checked against the referent without conversion; a borrow never rewrites
  // the storage it aliases.
  if (node.Ref === true) {
    if (!(v instanceof ReferenceValue)) {
      return Throw.TypeError('parameter $1 requires a ref argument', bindingId);
    }
    if (node.TypeAnnotation) {
      const referent = Q(yield* GetValue(v.Location));
      const ok = Q(yield* IsOfTypeNode(referent, node.TypeAnnotation.Type));
      if (!ok) {
        return Throw.TypeError('the argument bound by ref to $1 does not satisfy its type annotation', bindingId);
      }
    }
    if (!(lhs.Base instanceof DeclarativeEnvironmentRecord)) {
      return Throw.TypeError('parameter $1 cannot be bound by ref here', bindingId);
    }
    CreateRefBinding(lhs.Base, bindingId, v.Location, true);
    return NormalCompletion(undefined);
  }
  // proposal-runtime-types (references extension): a reference value reaching a
  // parameter that is not declared `ref` decays to the referent's value.
  if (v instanceof ReferenceValue) {
    v = Q(yield* GetValue(v.Location));
  }
  // 6. If environment is undefined, return ? PutValue(lhs, v).
  if (environment === Value.undefined) {
    return Q(yield* PutValue(lhs, v));
  }
  // 7. Return InitializeReferencedBinding(lhs, v).
  return yield* InitializeReferencedBinding(lhs, X(v));
}

// BindingRestElement :
//   `...` BindingIdentifier
//   `...` BindingPattern
function* IteratorBindingInitialization_BindingRestElement({ BindingIdentifier, BindingPattern }: ParseNode.BindingRestElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  if (BindingIdentifier) {
    // 1. Let lhs be ? ResolveBinding(StringValue of BindingIdentifier, environment).
    const lhs = Q(yield* ResolveBinding(StringValue(BindingIdentifier), environment, BindingIdentifier.strict));
    // 2. Let A be ! ArrayCreate(0).
    const array = X(ArrayCreate(0));
    // 3. Let n be 0.
    let n = 0;
    // 4. Repeat,
    while (true) {
      let next: 'done' | Value = 'done';
      // a. If iteratorRecord.[[Done]] is false, then
      if (iteratorRecord.Done === Value.false) {
        // i. Let next be ? IteratorStepValue(iteratorRecord).
        next = Q(yield* IteratorStepValue(iteratorRecord));
      }
      if (next === 'done') {
        // i. If environment is undefined, return ? PutValue(lhs, A).
        if (environment === Value.undefined) {
          return Q(yield* PutValue(lhs, array));
        }
        // ii. Return InitializeReferencedBinding(lhs, A).
        return yield* InitializeReferencedBinding(lhs, array);
      }
      // f. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), next));
      // g. Set n to n + 1.
      n += 1;
    }
  } else {
    // 1. Let A be ! ArrayCreate(0).
    const array = X(ArrayCreate(0));
    // 2. Let n be 0.
    let n = 0;
    // 3. Repeat,
    while (true) {
      let next: 'done' | Value = 'done';
      // a. If iteratorRecord.[[Done]] is false, then
      if (iteratorRecord.Done === Value.false) {
        // i. Let next be ? IteratorStepValue(iteratorRecord).
        next = Q(yield* IteratorStepValue(iteratorRecord));
      }
      // b. If next is done, then
      if (next === 'done') {
        // i. Return the result of performing BindingInitialization of BindingPattern with A and environment as the arguments.
        return yield* BindingInitialization(BindingPattern!, array, environment);
      }
      // f. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), Q(next)));
      // g. Set n to n + 1.
      n += 1;
    }
  }
}

function* IteratorBindingInitialization_BindingPattern({ BindingPattern, Initializer }: ParseNode.BindingElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  let v: Value = Value.undefined;
  // 1. If iteratorRecord.[[Done]] is false, then
  if (iteratorRecord.Done === Value.false) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next !== 'done') {
      v = next;
    }
  }
  // 3. If Initializer is present and v is undefined, then
  if (Initializer && v instanceof UndefinedValue) {
    // a. Let defaultValue be the result of evaluating Initializer.
    const defaultValue = Q(yield* Evaluate(Initializer));
    // b. Set v to ? GetValue(defaultValue).
    v = Q(yield* GetValue(defaultValue));
  }
  // 4. Return the result of performing BindingInitialization of BindingPattern with v and environment as the arguments.
  return yield* BindingInitialization(BindingPattern, X(v), environment);
}

function* IteratorDestructuringAssignmentEvaluation(node: ParseNode.Elision, iteratorRecord: IteratorRecord): PlainEvaluator {
  Assert(node.type === 'Elision');
  // 1. If iteratorRecord.[[Done]] is false, then
  if (iteratorRecord.Done === Value.false) {
    // a. Perform ? IteratorStep(iteratorRecord).
    Q(yield* IteratorStep(iteratorRecord));
  }
  // 2. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

export function* IteratorBindingInitialization_ArrayBindingPattern({ BindingElementList, BindingRestElement }: ParseNode.ArrayBindingPattern, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue): PlainEvaluator {
  for (const BindingElement of BindingElementList) {
    if (BindingElement.type === 'Elision') {
      Q(yield* IteratorDestructuringAssignmentEvaluation(BindingElement, iteratorRecord));
    } else {
      // TODO
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Q(yield* IteratorBindingInitialization_BindingElement(BindingElement as any, iteratorRecord, environment));
    }
  }

  if (BindingRestElement) {
    return Q(yield* IteratorBindingInitialization_BindingRestElement(BindingRestElement, iteratorRecord, environment));
  }
  return NormalCompletion(undefined);
}
