import {
  Value, Descriptor, ObjectValue, JSStringValue, wellKnownSymbols, type Arguments,
  ReferenceValue, ReferenceRunValue,
} from '../value.mts';
import { Evaluate, type PlainEvaluator } from '../evaluator.mts';
import { Q, X } from '../completion.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import { TemplateStrings } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  surroundingAgent,
  Assert,
  ArrayCreate,
  SetIntegrityLevel,
  ToString,
  GetIterator,
  GetValue,
  Get,
  GetMethod,
  EnumerableOwnProperties,
  Throw,
  F,
  IteratorStepValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-gettemplateobjec */
function GetTemplateObject(templateLiteral: ParseNode.TemplateLiteral) {
  // 1. Let realm be the current Realm Record.
  const realm = surroundingAgent.currentRealmRecord;
  // 2. Let templateRegistry be realm.[[TemplateMap]].
  const templateRegistry = realm.TemplateMap;
  // 3. For each element e of templateRegistry, do
  for (const e of templateRegistry) {
    // a. If e.[[Site]] is the same Parse Node as templateLiteral, then
    if (e.Site === templateLiteral) {
      // b. Return e.[[Array]].
      return e.Array;
    }
  }
  // 4. Let rawStrings be TemplateStrings of templateLiteral with argument true.
  const rawStrings = TemplateStrings(templateLiteral, true);
  // 5. Let cookedStrings be TemplateStrings of templateLiteral with argument false.
  const cookedStrings = TemplateStrings(templateLiteral, false);
  // 6. Let count be the number of elements in the List cookedStrings.
  const count = cookedStrings.length;
  // 7. Assert: count ≤ 232 - 1.
  Assert(count < (2 ** 32) - 1);
  // 8. Let template be ! ArrayCreate(count).
  const template = X(ArrayCreate(count));
  // 9. Let template be ! ArrayCreate(count).
  const rawObj = X(ArrayCreate(count));
  // 10. Let index be 0.
  let index = 0;
  // 11. Repeat, while index < count
  while (index < count) {
    // a. Let prop be ! ToString(𝔽(index)).
    const prop = X(ToString(F(index)));
    // b. Let cookedValue be the String value cookedStrings[index].
    const cookedValue = cookedStrings[index];
    // c. Call template.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: cookedValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(template.DefineOwnProperty(prop, Descriptor({
      Value: cookedValue,
      Writable: Value.false,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
    // d. Let rawValue be the String value rawStrings[index].
    const rawValue = rawStrings[index];
    // e. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    X(rawObj.DefineOwnProperty(prop, Descriptor({
      Value: rawValue,
      Writable: Value.false,
      Enumerable: Value.true,
      Configurable: Value.false,
    })));
    // f. Call rawObj.[[DefineOwnProperty]](prop, PropertyDescriptor { [[Value]]: rawValue, [[Writable]]: false, [[Enumerable]]: true, [[Configurable]]: false }).
    index += 1;
  }
  // 12. Perform SetIntegrityLevel(rawObj, frozen).
  X(SetIntegrityLevel(rawObj, 'frozen'));
  // 13. Perform SetIntegrityLevel(rawObj, frozen).
  X(template.DefineOwnProperty(Value('raw'), Descriptor({
    Value: rawObj,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  // 14. Perform SetIntegrityLevel(template, frozen).
  X(SetIntegrityLevel(template, 'frozen'));
  // 15. Append the Record { [[Site]]: templateLiteral, [[Array]]: template } to templateRegistry.
  templateRegistry.push({ Site: templateLiteral, Array: template });
  // 16. Return template.
  return template;
}

/** https://tc39.es/ecma262/#sec-template-literals-runtime-semantics-argumentlistevaluation */
//   TemplateLiteral : NoSubstitutionTemplate
//
// https://github.com/tc39/ecma262/pull/1402
//   TemplateLiteral : SubstitutionTemplate
function* ArgumentListEvaluation_TemplateLiteral(TemplateLiteral: ParseNode.TemplateLiteral): PlainEvaluator<Arguments> {
  switch (true) {
    case TemplateLiteral.TemplateSpanList.length === 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      return [siteObj] as Arguments;
    }

    case TemplateLiteral.TemplateSpanList.length > 1: {
      const templateLiteral = TemplateLiteral;
      const siteObj = GetTemplateObject(templateLiteral);
      const restSub = [];
      for (const Expression of TemplateLiteral.ExpressionList) {
        const subRef = Q(yield* Evaluate(Expression));
        const subValue = Q(yield* GetValue(subRef));
        restSub.push(subValue);
      }
      return [siteObj, ...restSub] as Arguments;
    }

    default:
      throw OutOfRange.nonExhaustive(TemplateLiteral);
  }
}

/** https://tc39.es/ecma262/#sec-argument-lists-runtime-semantics-argumentlistevaluation */
//   Arguments : `(` `)`
//   ArgumentList :
//     AssignmentExpression
//     `...` AssignmentExpression
//     ArgumentList `,` AssignmentExpression
//     ArgumentList `,` `...` AssignmentExpression
//
// (implicit)
//   Arguments :
//     `(` ArgumentList `)`
//     `(` ArgumentList `,` `)`
function* ArgumentListEvaluation_Arguments(Arguments: ParseNode.Arguments): PlainEvaluator<Arguments> {
  const precedingArgs = [];
  for (const element of Arguments) {
    if (element.type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element;
      // 2. Let spreadRef be the result of evaluating AssignmentExpression.
      const spreadRef = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let spreadObj be ? GetValue(spreadRef).
      const spreadObj = Q(yield* GetValue(spreadRef));
      // `...refs` FORWARDS a ref run - each location becomes a ref argument
      // of this call, the one way a run moves without any reference escaping.
      if (spreadObj instanceof ReferenceRunValue) {
        for (const location of spreadObj.Locations) {
          precedingArgs.push(new ReferenceValue(location));
        }
        continue;
      }
      // 4. Let iteratorRecord be ? GetIterator(spreadObj).
      const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
      // 5. Repeat,
      while (true) {
        // a. Let next be ? IteratorStepValue(iteratorRecord).
        const next = Q(yield* IteratorStepValue(iteratorRecord));
        // b. If next is false, return list.
        if (next === 'done') {
          break;
        }
        // d. Append next as the last element of list.
        precedingArgs.push(next);
      }
    } else if ((element as { type?: string }).type === 'NamedArgument') {
      // A named argument does not reach the positional path: a call with named
      // arguments is evaluated by ArgumentListEvaluationNamed against the callee's
      // parameters. This branch keeps the positional evaluation total.
      Assert(false, 'named argument in positional argument evaluation');
    } else {
      const AssignmentExpression = element as ParseNode.AssignmentExpressionOrHigher;
      // 2. Let ref be the result of evaluating AssignmentExpression.
      const ref = Q(yield* Evaluate(AssignmentExpression));
      // 3. Let arg be ? GetValue(ref).
      const arg = Q(yield* GetValue(ref));
      // 4. Append arg to the end of precedingArgs.
      precedingArgs.push(arg);
      // 5. Return precedingArgs.
    }
  }
  return precedingArgs as Arguments;
}

export function ArgumentListEvaluation(ArgumentsOrTemplateLiteral: ParseNode.TemplateLiteral | ParseNode.Arguments) {
  switch (true) {
    case isArray(ArgumentsOrTemplateLiteral):
      return ArgumentListEvaluation_Arguments(ArgumentsOrTemplateLiteral);
    case ('type' in ArgumentsOrTemplateLiteral && ArgumentsOrTemplateLiteral.type === 'TemplateLiteral'):
      return ArgumentListEvaluation_TemplateLiteral(ArgumentsOrTemplateLiteral);
    default:
      throw OutOfRange.nonExhaustive(ArgumentsOrTemplateLiteral);
  }
}

/**
 * Whether an argument list uses a by-name argument form: a named argument
 * `name: expr`, or a spread of an object literal `...{ a: 1 }`. A named argument
 * always binds by name. A spread of an object literal binds each property by
 * parameter name (the README's object-spread argument), and is recognized by its
 * syntax so that an ordinary iterable spread, `...arr` or `...[1, 2]`, is left to
 * the positional path unchanged. A list with neither is evaluated positionally.
 */
export function hasNamedArguments(args: ParseNode.Arguments): boolean {
  return args.some((element) => {
    const type = (element as { type?: string }).type;
    if (type === 'NamedArgument') {
      return true;
    }
    if (type === 'AssignmentRestElement') {
      const inner = (element as ParseNode.AssignmentRestElement).AssignmentExpression;
      return (inner as { type?: string }).type === 'ObjectLiteral';
    }
    return false;
  });
}

/**
 * The parameters of a function as named-argument resolution reads them: each
 * parameter's name and whether it may be omitted (it is optional, has a default,
 * or is the rest parameter), with the index of a rest parameter where present. A
 * named or object-spread call may omit a parameter only where it may be omitted;
 * a required parameter left unfilled is an error, since named arguments skip
 * defaulted parameters rather than required ones.
 */
function parameterInfo(func: Value): { names: string[], omittable: boolean[], restIndex: number } {
  const formals = ((func as { FormalParameters?: readonly ParseNode[] }).FormalParameters ?? []);
  const names: string[] = [];
  const omittable: boolean[] = [];
  let restIndex = -1;
  formals.forEach((p, i) => {
    const node = p as {
      type?: string,
      BindingIdentifier?: { name?: string },
      Optional?: boolean,
      Initializer?: unknown,
      TypedInitializer?: unknown,
    };
    if (node.type === 'BindingRestElement') {
      restIndex = i;
      names.push(node.BindingIdentifier?.name ?? '');
      omittable.push(true);
    } else {
      names.push(node.BindingIdentifier?.name ?? '');
      const hasDefault = (node.Initializer !== undefined && node.Initializer !== null)
        || (node.TypedInitializer !== undefined && node.TypedInitializer !== null);
      omittable.push(node.Optional === true || hasDefault);
    }
  });
  return { names, omittable, restIndex };
}

/**
 * The same, read off a SIGNATURE in view rather than the callee's own parameter
 * list. #sec-call-argument-binding: a call is bound "to the parameters of the
 * selected signature"; where the callee is reached through a binding whose
 * declared type is a function type or an interface of call signatures, that type's
 * signature is the declaration the call site reads - the callee's own names are
 * not in view and need not agree (README, "Function Interfaces": "if an interface
 * is used then the name can be changed in the passed in function"). Its defaults
 * are what fill a skipped position, so the callee receives a full positional
 * list and its own defaults never engage. With several signatures, the first
 * whose names cover every named argument is selected.
 */
type SignatureInView = { Parameters: readonly { Name: string, Type?: unknown, Optional: boolean, Rest: boolean, Initial?: Value }[] };

function parameterInfoOfSignature(sig: SignatureInView): { names: string[], omittable: boolean[], restIndex: number, initials: (Value | undefined)[], types: unknown[] } {
  const names: string[] = [];
  const omittable: boolean[] = [];
  const initials: (Value | undefined)[] = [];
  const types: unknown[] = [];
  let restIndex = -1;
  sig.Parameters.forEach((p, i) => {
    names.push(p.Name);
    if (p.Rest) {
      restIndex = i;
    }
    omittable.push(p.Rest || p.Optional || p.Initial !== undefined);
    initials.push(p.Initial);
    types.push(p.Type);
  });
  return { names, omittable, restIndex, initials, types };
}

/** The signature in view for a callee reference, or undefined where its binding declares no callable type. */
export function signatureInView(declaredType: unknown, namedArguments: readonly string[]): SignatureInView | undefined {
  let t = declaredType as { Kind?: string, Structure?: unknown, Signatures?: readonly SignatureInView[] } | undefined;
  if (t && t.Kind === 'nominal') {
    t = t.Structure as typeof t;
  }
  if (!t || t.Kind !== 'function' || !t.Signatures || t.Signatures.length === 0) {
    return undefined;
  }
  return t.Signatures.find((s) => namedArguments.every((n) => s.Parameters.some((p) => p.Name === n))) ?? t.Signatures[0];
}

/**
 * Evaluates an argument list that uses by-name forms and returns the positional
 * argument list to pass to the call, using the called function's parameter names.
 * A positional argument fills the next position. A named argument `name: expr`
 * fills the position of the parameter with that name, or the rest position onward
 * where the name is the rest parameter's. A spread of a plain object binds each
 * own enumerable property by parameter name; a spread of an iterable fills the
 * next positions in order, as an ordinary spread does. A position with no argument
 * is left absent for the callee's own default to fill; a named argument that
 * matches no parameter is a TypeError.
 */
export function* ArgumentListEvaluationNamed(args: ParseNode.Arguments, func: Value, signature?: SignatureInView): PlainEvaluator<Arguments> {
  const info = signature ? parameterInfoOfSignature(signature) : { ...parameterInfo(func), initials: [] as (Value | undefined)[], types: [] as unknown[] };
  const { names, omittable, restIndex, initials, types } = info;
  const fixedCount = restIndex === -1 ? names.length : restIndex;
  const positioned: Value[] = [];
  const restCollected: Value[] = [];
  const byName = new Map<string, Value>();
  // Once a named argument targets the rest parameter, the following positional
  // arguments continue that rest rather than filling fixed positions: the design's
  // `f(8, args: 'a', 'b')` gives `args` both 'a' and 'b'.
  let restOpen = false;

  // A positional value fills the next fixed position, or joins the rest once the
  // fixed positions are used or the rest has been opened by a named rest argument.
  const placePositional = (value: Value): void => {
    if (!restOpen && positioned.length < fixedCount) {
      positioned.push(value);
    } else {
      restCollected.push(value);
    }
  };

  const placeNamed = (name: string, value: Value): PlainEvaluator<void> => (function* place() {
    const idx = names.indexOf(name);
    if (idx === -1) {
      return Throw.TypeError('no parameter named $1 for this call', Value(name));
    }
    if (restIndex !== -1 && idx === restIndex) {
      restCollected.push(value);
      restOpen = true;
    } else {
      byName.set(name, value);
    }
    return undefined;
  }());

  for (const element of args) {
    if ((element as { type?: string }).type === 'NamedArgument') {
      const named = element as ParseNode.NamedArgument;
      const ref = Q(yield* Evaluate(named.AssignmentExpression));
      const value = Q(yield* GetValue(ref));
      Q(yield* placeNamed(named.Name, value));
    } else if ((element as { type?: string }).type === 'AssignmentRestElement') {
      const { AssignmentExpression } = element as ParseNode.AssignmentRestElement;
      const spreadRef = Q(yield* Evaluate(AssignmentExpression));
      const spreadObj = Q(yield* GetValue(spreadRef));
      // A plain object spread binds by parameter name; an iterable spread fills
      // positions in order. Distinguish by whether the value has an iterator.
      const method = spreadObj instanceof ObjectValue
        ? Q(yield* GetMethod(spreadObj, wellKnownSymbols.iterator))
        : Value.undefined;
      if (spreadObj instanceof ObjectValue && method === Value.undefined) {
        // Object spread: bind each own enumerable string-keyed property by name.
        const keys = Q(yield* EnumerableOwnProperties(spreadObj, 'key'));
        for (const key of keys) {
          const value = Q(yield* Get(spreadObj, key as JSStringValue));
          Q(yield* placeNamed((key as JSStringValue).stringValue(), value));
        }
      } else {
        const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
        while (true) {
          const next = Q(yield* IteratorStepValue(iteratorRecord));
          if (next === 'done') {
            break;
          }
          placePositional(next);
        }
      }
    } else {
      const ref = Q(yield* Evaluate(element as ParseNode.AssignmentExpressionOrHigher));
      const value = Q(yield* GetValue(ref));
      placePositional(value);
    }
  }

  // Assemble the positional list the call receives. Each fixed parameter takes
  // its positional value, else its named value, else undefined where it may be
  // omitted (its default applies), else it is a required parameter left unfilled,
  // an error. The rest parameter, where present, is followed by every collected
  // rest value in source order.
  const result: Value[] = [];
  for (let i = 0; i < fixedCount; i += 1) {
    if (i < positioned.length) {
      result.push(positioned[i]);
    } else if (byName.has(names[i])) {
      result.push(byName.get(names[i])!);
    } else if (omittable[i]) {
      // The signature in view supplies its default; otherwise the position is
      // left undefined for the callee's own default.
      result.push(initials[i] ?? Value.undefined);
    } else {
      return Throw.TypeError('no argument for the required parameter $1', Value(names[i] || String(i)));
    }
    // With a signature in view, an UNTYPED PRIMITIVE argument takes the
    // parameter's type by conversion - literal propagation at an argument
    // position, as a declared parameter performs at its own binding
    // (IteratorBindingInitialization). The implementer may be untyped and
    // convert nothing itself; without this, `g(x: 2)` at `(x: uint8, y: uint8 =
    // 9)` handed it a Number beside a `uint8` default and the two did not mix.
    const t = types[i] as { Kind?: string } | undefined;
    const v = result[i];
    if (signature && t && t.Kind !== undefined && t.Kind !== 'any' && v !== undefined && !(v instanceof ObjectValue) && v !== Value.undefined) {
      result[i] = Q(yield* ConvertValue(v, t as never));
    }
  }
  for (const v of restCollected) {
    result.push(v);
  }
  // proposal-runtime-types: a rest may be
  // followed by further parameters, and a named argument may name one of them.
  // The assembly stopped at the rest, so `f(1, 2, b: "x")` for
  // `function f(...a: [].<number>, b: string)` dropped the b entirely and the
  // call failed as unassignable. Values named for parameters after the rest are
  // appended in parameter order; one that is absent is simply not supplied, and
  // the binding rejects it if the parameter is required, which is the same
  // answer by the same rule that governs a positional call.
  if (restIndex !== -1) {
    for (let i = restIndex + 1; i < names.length; i += 1) {
      if (byName.has(names[i])) {
        result.push(byName.get(names[i])!);
      }
    }
  }
  return result as Arguments;
}

