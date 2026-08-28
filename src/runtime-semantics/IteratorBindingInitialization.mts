import { Value, ReferenceValue } from '../value.mts';
import { DecayReferenceValue } from '../abstract-ops/reference-operations.mts';
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
import { EnforceAnnotation, IsOfTypeNode, CheckedConvertValue } from '../abstract-ops/runtime-types.mts';
import { CreateListIteratorRecord } from '../abstract-ops/iterator-operations.mts';
import { IsOfType, TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { restElementType } from '../type-system/records.mts';
import { SequenceAssignment } from '../type-system/sequence-assignment.mts';
import { NamedEvaluation, BindingInitialization } from './all.mts';
import {
  Assert,
  GetValue,
  InitializeReferencedBinding,
  CopyValueClassInstance,
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

/**
 * Whether _node_ is an element of a destructuring PATTERN rather than a plain
 * formal parameter or a plain declaration, both of which have their own
 * boundary elsewhere.
 */
function isPatternElement(node: ParseNode): boolean {
  let up = (node as { parent?: ParseNode }).parent;
  for (let i = 0; up && i < 4; i += 1) {
    if (up.type === 'ArrayBindingPattern' || up.type === 'ObjectBindingPattern') {
      return true;
    }
    // A formal parameter list is not a ParseNode of its own - the parameters
    // hang off the function node - so the boundary is the function itself.
    const stopAt: readonly string[] = ['LexicalBinding', 'VariableDeclaration', 'FunctionDeclaration',
      'FunctionExpression', 'ArrowFunction', 'MethodDefinition', 'AsyncArrowFunction'];
    if (stopAt.includes(up.type)) {
      return false;
    }
    up = (up as { parent?: ParseNode }).parent;
  }
  return false;
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
  //
  // A parameter ANNOTATED with a reference type, `function move(p: ref
  // Particle)`, is not such a parameter: its declared type says it takes a
  // borrow, so the borrow is what it receives. This is the form soa.md relies
  // on for storage independence - "a system written against one storage works
  // against the other" - where the same `ref Particle` parameter is passed a
  // borrow of an `SoA` element by one caller and of a `[].<T>` element by
  // another, and neither call site says which layout produced it.
  const annotatedRef = node.TypeAnnotation?.Type?.type === 'ReferenceType';
  if (v instanceof ReferenceValue && !annotatedRef) {
    v = Q(yield* DecayReferenceValue(v));
  }
  // proposal-runtime-types #table-check-sites: a binding with a |TypeAnnotation|
  // is a boundary, and an element of a PATTERN is no exception. The design
  // writes `let [a: uint8, b: uint8] = [1, 2]` and
  // `function f([a: uint8])`, and the annotation was read here only to decide
  // whether a reference decays - so the element bound unchecked and
  // unconverted: `let [a: uint8] = [300]` bound 300 and `["s"]` bound a string,
  // where the same annotation on a plain binding refuses both.
  //
  // Only an element INSIDE a pattern. A plain formal parameter reaches this
  // operation too, and its type is enforced by EnforceParameterTypes with the
  // call's type-parameter bindings in hand; enforcing it here as well refused
  // `function g<T extends []>(v: T)` for every argument, because `T` is unbound
  // at this point. The pattern element is the case with no other boundary.
  if (node.TypeAnnotation && !annotatedRef && isPatternElement(node)) {
    v = Q(yield* EnforceAnnotation(node.TypeAnnotation, v));
  }
  // 6. If environment is undefined, return ? PutValue(lhs, v).
  if (environment === Value.undefined) {
    return Q(yield* PutValue(lhs, v));
  }
  // #sec-value-type-copying, as at a keyed binding: an array pattern and a
  // PARAMETER LIST both bind a name to a value taken from an iterator or from a
  // default, and a read into a binding is a copy position. `const [_q_] = _arr_`
  // and `function f(p: P = _a_)` copy for the reason `const _b_ = _a_` does.
  // 7. Return InitializeReferencedBinding(lhs, v).
  return yield* InitializeReferencedBinding(lhs, CopyValueClassInstance(X(v)));
}

// BindingRestElement :
//   `...` BindingIdentifier
//   `...` BindingPattern
function* IteratorBindingInitialization_BindingRestElement({ BindingIdentifier, BindingPattern, TypeAnnotation }: ParseNode.BindingRestElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  if (BindingIdentifier) {
    // 1. Let lhs be ? ResolveBinding(StringValue of BindingIdentifier, environment).
    const lhs = Q(yield* ResolveBinding(StringValue(BindingIdentifier), environment, BindingIdentifier.strict));
    // #sec-type-annotations: "A rest element's annotation is the type of what it
    // COLLECTS", so each argument the rest takes is checked against that type's
    // ELEMENT type (D41, and D32's run-time half). This function did not read its
    // annotation at all - the parameter was not even destructured - so a rest was
    // the ONE position in the language whose declared type the run time ignored.
    let restElement: TypeRecord | undefined;
    if (TypeAnnotation) {
      const resolvedRest = EnsureCompletion(yield* TypeNodeToTypeRecord(TypeAnnotation.Type));
      if (resolvedRest.Type !== 'throw' && resolvedRest.Value) {
        restElement = restElementType(resolvedRest.Value as TypeRecord);
      }
    }
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
      // `CheckedConvertValue`, which is what `EnforceAnnotation` reaches for a
      // FIXED parameter - not `IsOfType`. Binding CONVERTS: an untyped literal
      // adapts to a declared type, so `f("a", 0, 1, 2, 3)` at
      // `...args: [].<uint32>` is valid and five corpus programs assert it. The
      // ASSIGNED-PARAMETERS path uses `IsOfType` because it is choosing WHICH
      // SLOT takes an argument; this path is binding one, and the two questions
      // want different operations.
      //
      // Written as a STATEMENT. `Q` is a macro and is hoisted out of a
      // short-circuit, so `guard && Q(yield* …)` evaluates the call whatever the
      // guard says - which called the check with an absent type for every
      // UNTYPED rest and faulted.
      if (restElement !== undefined) {
        next = Q(yield* CheckedConvertValue(next as Value, restElement));
      }
      // f. Perform ! CreateDataPropertyOrThrow(A, ! ToString(𝔽(n)), next).
      // proposal-runtime-types (references extension): a rest parameter is an
      // array, a store a reference cannot survive, so a ref argument gathered
      // by a rest decays to its referent's value as it is collected.
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), Q(yield* DecayReferenceValue(next))));
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
      // proposal-runtime-types (references extension): as above, the gathered
      // element decays.
      X(CreateDataPropertyOrThrow(array, X(ToString(F(n))), Q(yield* DecayReferenceValue(Q(next)))));
      // g. Set n to n + 1.
      n += 1;
    }
  }
}

function* IteratorBindingInitialization_BindingPattern({ BindingPattern, Initializer, TypeAnnotation }: ParseNode.BindingElement, iteratorRecord: IteratorRecord, environment: EnvironmentRecord | UndefinedValue) {
  let v: Value = Value.undefined;
  // 1. If iteratorRecord.[[Done]] is false, then
  if (iteratorRecord.Done === Value.false) {
    // a. Let next be ? IteratorStepValue(iteratorRecord).
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    if (next !== 'done') {
      // proposal-runtime-types (references extension): a parameter that is a
      // destructuring pattern consumes its argument as a value, so a ref
      // argument decays to the referent before the pattern takes it apart.
      v = Q(yield* DecayReferenceValue(next));
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
  // OUTSTANDING item H. The annotation on a DESTRUCTURED binding types the value
  // BEING destructured, so it is enforced here - before the pattern takes names
  // out of it - rather than on the names, which have their own types from the
  // annotated type's members.
  //
  // Parsing it without enforcing would be the failure the `where` work already
  // met: "parsing the clause without checking it would let it be written and
  // silently ignored, which is worse than the Syntax Error it replaced."
  if (TypeAnnotation) {
    v = Q(yield* EnforceAnnotation(TypeAnnotation, X(v)));
  }
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
