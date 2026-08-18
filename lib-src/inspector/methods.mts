import type { Protocol } from 'devtools-protocol';
import type {
  DebuggerContext,
  DebuggerNamespace, HeapProfilerNamespace, ProfilerNamespace, RuntimeNamespace,
  TargetNamespace,
} from './types.mts';
import { getParsedEvent } from './internal-utils.mts';
import { InspectorContext } from './context.mts';
import {
  Call, NormalCompletion, ObjectValue, ParseScript, ScriptRecord, surroundingAgent, ThrowCompletion, skipDebugger, Value, type FunctionObject,
  CreateBuiltinFunction, PerformPromiseThen, type Arguments, type DevtoolsEvalReport, type ManagedRealm, type PromiseObject,
  ParseModule,
  SourceTextModuleRecord,
  ValueOfNormalCompletion,
  JSStringValue,
  evalQ,
  Assert,
  kInternal,
  captureStack,
  isEvaluator,
  getBreakpointCandidateNodes,
  parseNodeToBreakpointLocation,
  performDevtoolsEval,
  isFunctionObject,
  ModuleRecord,
  GetModuleNamespace,
  X,
} from '#self';

export const Debugger: DebuggerNamespace = {
  enable(_req, context) {
    context.onDebuggerConnect();
    return { debuggerId: 'debugger.0' };
  },
  disable(_req, context) {
    context.onDebuggerDisconnect();
  },
  getScriptSource({ scriptId }) {
    const source = surroundingAgent.parsedSources.get(scriptId);
    if (!source) {
      throw new Error('Not found');
    }
    return { scriptSource: source.ECMAScriptCode.sourceText };
  },
  setAsyncCallStackDepth() { },
  setBlackboxPatterns() { },
  setBlackboxExecutionContexts() { },

  // #region breakpoints
  getPossibleBreakpoints({ start, end, restrictToFunction }) {
    return {
      locations: [...getBreakpointCandidateNodes(start, end, restrictToFunction)]
        .map((node) => parseNodeToBreakpointLocation(start.scriptId, node)),
    };
  },
  removeBreakpoint({ breakpointId }) {
    surroundingAgent?.removeBreakpoint(breakpointId);
  },
  setBreakpoint(req) {
    return surroundingAgent.addBreakpointByLocation(req);
  },
  setBreakpointByUrl(req) {
    return surroundingAgent.addBreakpointByUrl(req);
  },
  setBreakpointOnFunctionCall(req, context) {
    const f = context.context.getObject(req.objectId);
    if (!f || !isFunctionObject(f)) return { breakpointId: null! };
    return surroundingAgent.addBreakpointOnFunctionCall(f, req.condition);
  },
  setInstrumentationBreakpoint(req) {
    return surroundingAgent.addInstrumentationBreakpoint(req);
  },
  setBreakpointsActive({ active }) {
    surroundingAgent.breakpointsEnabled = active;
  },
  setPauseOnExceptions({ state }) {
    if (surroundingAgent) {
      surroundingAgent.pauseOnExceptions = state === 'none' ? undefined : state;
    }
  },
  // #endregion

  stepInto(_, { sendEvent }) {
    sendEvent['Debugger.resumed']();
    surroundingAgent.resumeEvaluate({ pauseAt: 'step-in' });
  },
  resume(_, { sendEvent }) {
    sendEvent['Debugger.resumed']();
    surroundingAgent.resumeEvaluate();
  },
  stepOver(_req, { sendEvent }) {
    sendEvent['Debugger.resumed']();
    surroundingAgent.resumeEvaluate({ pauseAt: 'step-over' });
  },
  stepOut(_req, { sendEvent }) {
    sendEvent['Debugger.resumed']();
    surroundingAgent.resumeEvaluate({ pauseAt: 'step-out' });
  },
  evaluateOnCallFrame(req, context) {
    return evaluate({
      ...req,
      uniqueContextId: context.context.getRealm(undefined)!.descriptor.uniqueId,
      evalMode: context.context.evaluateMode,
    }, context);
  },
  engine262_setEvaluateMode({ mode }, { context }) {
    if (mode === 'module' || mode === 'script' || mode === 'console') {
      context.evaluateMode = mode;
    }
  },
  engine262_setFeatures() {
    throw new Error('Method should not be implemented here.');
  },
};
export const Profiler: ProfilerNamespace = {
  enable() { },
};
/**
 * Whether a console entry is module code by its own syntax.
 *
 * A static `import` or `export` is a Module production, so no script parse can
 * accept it however it is parameterised, and an entry containing one has only
 * one goal it could have. The evaluate-mode dropdown therefore does not need to
 * be told: the entry says what it is.
 *
 * Used by BOTH `compileScript` and `evaluate`, which is the point of it being
 * one function. `evaluate` detected this and `compileScript` did not, and the
 * console calls `compileScript` FIRST - to decide whether the input is complete
 * - so module syntax was refused there before the goal-detecting path was ever
 * reached. The dropdown was the only way through, and a preprocessor import
 * needs the module goal, so the feature looked broken to anyone who had not
 * found the dropdown.
 *
 * A dynamic `import()` is excluded: it is an ordinary expression that a script
 * parses, and it resolves during evaluation - too late to feed the expander -
 * so it neither needs the module goal nor implies it.
 */
export function DeclaresModuleSyntax(expression: string): boolean {
  return /^[\s;]*(import|export)\s/m.test(expression)
    && !/^[\s;]*import\s*\(/m.test(expression);
}

export const Runtime: RuntimeNamespace = {
  discardConsoleEntries() { },
  enable() {},
  compileScript(options, { context, sendEvent }) {
    let parsed!: ScriptRecord | SourceTextModuleRecord | ObjectValue[];
    let realm = context.getRealm(options.executionContextId);
    if (!realm && !options.persistScript) {
      realm = context.getAnyRealm();
    }
    if (!realm) {
      return unsupportedError;
    }
    const pop = realm.realm.pushTopContext();
    // The dropdown OR the entry's own syntax. The console calls this before it
    // submits, so a mismatch here is what decides whether an entry runs at all.
    if (context.evaluateMode === 'module' || DeclaresModuleSyntax(options.expression)) {
      parsed = ParseModule(options.expression, realm.realm, { specifier: options.sourceURL, doNotTrackScriptId: !options.persistScript });
    } else {
      parsed = ParseScript(options.expression, realm.realm, { specifier: options.sourceURL, doNotTrackScriptId: !options.persistScript, [kInternal]: { allowAllPrivateNames: true, allowAwait: true } });
    }
    pop?.();
    if (!parsed) {
      throw new Error('No parsed result');
    }
    if (Array.isArray(parsed)) {
      const e = context.createExceptionDetails(ThrowCompletion(parsed[0]), false);
      // Note: this message is what triggers devtools' line wrap, so it is used
      // where the input really did end early - devtools then waits for the rest
      // rather than submitting.
      //
      // It used to be set for EVERY parse error, which made malformed input
      // indistinguishable from unfinished input: the console would not submit
      // on Enter and never showed the actual error, so a program with a genuine
      // syntax error could not be run or diagnosed at all.
      if ((parsed[0] as { HostDefinedAtEndOfInput?: boolean }).HostDefinedAtEndOfInput) {
        e.exception!.description = 'SyntaxError: Unexpected end of input';
      }
      return { exceptionDetails: e };
    }
    if (options.persistScript) {
      if (realm?.descriptor.id === undefined) {
        throw new Error('No realm id found');
      }
      const event = getParsedEvent(parsed, parsed.HostDefined!.scriptId!, realm.descriptor.id);
      sendEvent['Debugger.scriptParsed'](event);
      return { scriptId: event.scriptId };
    }
    return {};
  },
  callFunctionOn(options, { context }): Protocol.Runtime.CallFunctionOnResponse {
    const realmDesc = context.getRealm(options.uniqueContextId || options.executionContextId) || context.getAnyRealm();
    if (!realmDesc) {
      throw new Error('No realm found');
    }
    const { Value: F } = realmDesc.realm.evaluateScriptSkipDebugger(`(${options.functionDeclaration})`, { doNotTrackScriptId: true }) as NormalCompletion<FunctionObject>;
    const thisValue = options.objectId
      ? context.getObject(options.objectId)!
      : Value.undefined;
    const args = options.arguments?.map((a) => {
      // TODO: revisit
      if ('value' in a) {
        return Value(a.value);
      }
      if (a.objectId) {
        return context.getObject(a.objectId)!;
      }
      if ('unserializableValue' in a) {
        throw new RangeError();
      }
      return Value.undefined;
    });
    const pop = realmDesc.realm.pushTopContext();
    const completion = evalQ((Q): Protocol.Runtime.CallFunctionOnResponse => {
      const r = Q(skipDebugger(Call(F, thisValue, args || [])));
      if (options.returnByValue) {
        const value = X(Call(realmDesc.realm.Intrinsics['%JSON.stringify%'], Value.undefined, [r]));
        if (value instanceof JSStringValue) {
          const valueRealized = JSON.parse(value.stringValue());
          return { result: { type: typeof value, value: valueRealized } };
        }
      }
      return context.createEvaluationResult(r);
    });
    pop?.();
    if (completion instanceof ThrowCompletion) {
      return { result: { type: 'undefined' }, exceptionDetails: context.createExceptionDetails(completion, false) };
    }
    return completion.Value;
  },
  evaluate(options, context) {
    return evaluate({
      ...options,
      evalMode: context.context.evaluateMode,
      uniqueContextId: options.uniqueContextId!,
    }, context);
  },
  /**
   * https://chromedevtools.github.io/devtools-protocol/v8/Runtime/#method-awaitPromise
   *
   * Settle a promise the frontend already holds and answer from how it settled.
   * Distinct from `Runtime.evaluate`'s `awaitPromise` flag, which settles the
   * result of an evaluation: this one is handed an object id.
   */
  awaitPromise(req, { context }) {
    const object = context.getObject(req.promiseObjectId);
    if (!isPromiseObject(object!)) {
      return {
        result: { type: 'undefined' },
        exceptionDetails: {
          text: 'Runtime.awaitPromise: the object is not a promise.',
          lineNumber: 0,
          columnNumber: 0,
          exceptionId: 0,
        },
      };
    }
    const realm = context.getRealm(undefined);
    if (!realm) {
      return unsupportedError;
    }
    return new Promise<Protocol.Runtime.AwaitPromiseResponse>((resolve) => {
      settleThenResolve(realm.realm, object, context, resolve);
    }) as unknown as Protocol.Runtime.AwaitPromiseResponse;
  },
  getExceptionDetails(req, { context }) {
    const object = context.getObject(req.errorObjectId)!;
    if (object instanceof ObjectValue) {
      return {
        exceptionDetails: context.createExceptionDetails(ThrowCompletion(object), false),
      };
    }
    return {
      exceptionDetails: {
        text: 'unsupported', lineNumber: 0, columnNumber: 0, exceptionId: 0,
      },
    };
  },
  getHeapUsage() {
    return {
      usedSize: 0, totalSize: 0, backingStorageSize: 0, embedderHeapUsedSize: 0,
    };
  },
  getIsolateId() {
    return { id: 'isolate.0' };
  },
  getProperties(options, { context }) {
    return context.getProperties(options);
  },
  globalLexicalScopeNames({ executionContextId }, { context }) {
    const global = context.getRealm(executionContextId)?.realm.GlobalObject;
    if (!global) {
      return { names: [] };
    }
    const keys = skipDebugger(global.OwnPropertyKeys());
    if (keys instanceof ThrowCompletion) {
      return { names: [] };
    }
    return { names: ValueOfNormalCompletion(keys).map((k) => (k instanceof JSStringValue ? k.stringValue() : null!)).filter(Boolean) };
  },
  releaseObject(req, { context }) {
    context.releaseObject(req.objectId);
  },
  releaseObjectGroup({ objectGroup }, { context }) {
    context.releaseObjectGroup(objectGroup);
  },
  runIfWaitingForDebugger() { },
};
export const HeapProfiler: HeapProfilerNamespace = {
  enable() { },
  collectGarbage() { },
};

export const Target: TargetNamespace = {
  setDiscoverTargets() { },
  // @ts-expect-error no doc
  setRemoteLocations() { },
};

const unsupportedError: Protocol.Runtime.EvaluateResponse = {
  result: { type: 'undefined' },
  exceptionDetails: {
    text: 'unsupported', lineNumber: 0, columnNumber: 0, exceptionId: 0,
  },
};
function evaluate(options: {
  uniqueContextId: string,
  expression: string,
  evalMode: InspectorContext['evaluateMode'],
  throwOnSideEffect?: boolean,
  awaitPromise?: boolean,
  /**
   * The protocol's own signal that this is REPL input, which among other things
   * means top-level `await` is expected to work. The devtools console sets it on
   * every evaluation it makes and does no rewriting of its own - it relies on
   * the backend to accept the await - so ignoring it is what made
   * `await x;` a SyntaxError in the console.
   */
  replMode?: boolean,
  callFrameId?: string,
}, inspectorContext: DebuggerContext): Protocol.Runtime.EvaluateResponse | Promise<Protocol.Runtime.EvaluateResponse> {
  const { context } = inspectorContext;
  const isPreview = options.throwOnSideEffect;
  // A preview carries `replMode` too - the console requests previews with
  // `throwOnSideEffect: true, replMode: true` while the user is still typing -
  // so the flag alone must not select a path that evaluates. Previews already
  // route below by `isPreview` and keep their own handling.
  const isRepl = !!options.replMode && !isPreview;
  const realm = context.getRealm(options.uniqueContextId);
  if (!realm) {
    return unsupportedError;
  }

  const isCallOnFrame = typeof options.callFrameId === 'string';
  // `awaitPromise` asks for a promise RESULT to be settled before replying. A
  // preview must not honour it - waiting on a promise is the running a preview
  // exists to avoid - and neither can a paused call frame, whose loop is not
  // turning, so a wait there would never end.
  const shouldAwaitResult = !!options.awaitPromise && !isPreview && !isCallOnFrame;
  let callOnFramePoppedLevel = 0;
  const oldExecutionStack = [...surroundingAgent.executionContextStack];
  if (isCallOnFrame) {
    const frame = surroundingAgent.executionContextStack[options.callFrameId as `${number}`];
    if (!frame) {
      inspectorContext.sendEvent['Runtime.exceptionThrown']({
        timestamp: Date.now(),
        exceptionDetails: {
          columnNumber: 0,
          exceptionId: 0,
          lineNumber: 0,
          text: `Execution context not found for callFrameId ${options.callFrameId}`,
        },
      });
      return unsupportedError;
    }
    for (const currentFrame of [...surroundingAgent.executionContextStack].reverse()) {
      if (currentFrame === frame) {
        break;
      }
      callOnFramePoppedLevel += 1;
      surroundingAgent.executionContextStack.pop(currentFrame);
    }
  }
  const promise = new Promise<Protocol.Runtime.EvaluateResponse>((resolve) => {
    // Filled in by performDevtoolsEval when the source only parsed as an async
    // body, which is what makes its value a promise standing for the result
    // rather than the result.
    const evalReport: DevtoolsEvalReport = { isAsync: false };
    let toBeEvaluated;
    // A console entry that DECLARES an import or an export is module code and
    // cannot parse any other way, so it takes the module goal even in REPL mode.
    //
    // This is not the top-level-await path, which already works by re-parsing a
    // SCRIPT with the await parameter - a static `import` is a Module
    // production, so no script parse can accept it however it is parameterised.
    //
    // It matters beyond convenience for a PREPROCESSOR import: `#sec-expansion`
    // collects macro names from the parsed body's own imports and expands before
    // evaluation, so a macro must be imported by the very unit that uses it. A
    // dynamic `import()` resolves during evaluation, after expansion is over,
    // and can never feed the expander - which is why a console that cannot take
    // a static import cannot use macros at all.
    //
    // A module-parsed entry gets module semantics: its bindings are its own and
    // the next entry does not see them. That is the price of the goal rather
    // than a choice made here.
    const declaresModuleSyntax = !isPreview && DeclaresModuleSyntax(options.expression);
    if (declaresModuleSyntax && !isCallOnFrame) {
      const moduleRealm = context.getRealm(options.uniqueContextId);
      if (!moduleRealm) {
        resolve(unsupportedError);
        return;
      }
      const parsedModule = ParseModule(options.expression, moduleRealm.realm, { specifier: 'console' });
      if (Array.isArray(parsedModule)) {
        const e = context.createExceptionDetails(ThrowCompletion(parsedModule[0]), false);
        resolve({ exceptionDetails: e, result: { type: 'undefined' } });
        return;
      }
      toBeEvaluated = parsedModule;
    } else if (isPreview || isRepl || options.evalMode === 'console' || isCallOnFrame) {
      toBeEvaluated = performDevtoolsEval(options.expression, realm.realm, false, !!(isPreview || isCallOnFrame), evalReport);
    } else {
      let parsed!: ScriptRecord | SourceTextModuleRecord | ObjectValue[];
      const realm = context.getRealm(options.uniqueContextId);
      if (!realm) {
        resolve(unsupportedError);
        return;
      }
      if (options.evalMode === 'module') {
        parsed = ParseModule(options.expression, realm.realm);
      } else {
        parsed = ParseScript(options.expression, realm.realm);
      }
      if (Array.isArray(parsed)) {
        const e = context.createExceptionDetails(ThrowCompletion(parsed[0]), false);
        resolve({ exceptionDetails: e, result: { type: 'undefined' } });
        return;
      }
      toBeEvaluated = parsed;
    }

    const noDebuggerEvaluate = () => {
      if (!isEvaluator(toBeEvaluated)) {
        throw new Assert.Error('Unexpected');
      }
      const completion = skipDebugger(toBeEvaluated);
      if (evalReport.isAsync && isCallOnFrame) {
        // The body suspended on an `await`, and the frame it was evaluated on is
        // paused: the loop that would settle it is not turning, so answering the
        // promise would answer something that can never resolve. Say why instead.
        resolve({
          result: { type: 'undefined' },
          exceptionDetails: {
            text: 'Cannot await on a paused call frame: resume execution first.',
            lineNumber: 0,
            columnNumber: 0,
            exceptionId: 0,
          },
        });
        return;
      }
      resolve(context.createEvaluationResult(completion));
    };
    if (isPreview) {
      surroundingAgent.debugger_scopePreview(noDebuggerEvaluate);
      return;
    }
    if (isCallOnFrame) {
      noDebuggerEvaluate();
      return;
    }


    if (toBeEvaluated instanceof ModuleRecord) {
      realm.realm.evaluateModule(toBeEvaluated, undefined, (completion) => {
        if (completion instanceof ThrowCompletion) {
          resolve(context.createEvaluationResult(completion));
        } else {
          resolve(context.createEvaluationResult(NormalCompletion(GetModuleNamespace(toBeEvaluated, 'evaluation'))));
        }
      });
    } else if (toBeEvaluated instanceof ScriptRecord) {
      realm.realm.evaluateScript(toBeEvaluated, {}, (completion) => {
        resolve(context.createEvaluationResult(completion));
      });
    } else {
      let completion;
      surroundingAgent.evaluate(toBeEvaluated, (c) => {
        completion = c;
        // An async body answers the promise standing for its result, and the
        // console asked for the result. The devtools frontend does not unwrap
        // this - it displays whatever the backend returns - so settling here is
        // the difference between `await 1;` reading as `1` and as `Promise {}`.
        //
        // Only when the body WAS async. A synchronous body whose value happens
        // to be a promise - `Promise.resolve(1)` - is a promise the user asked
        // to see, and settling that would answer 1 for an expression that never
        // awaited anything.
        if ((evalReport.isAsync || shouldAwaitResult) && !(c instanceof ThrowCompletion) && isPromiseObject(c.Value)) {
          settleThenResolve(realm.realm, c.Value, context, resolve);
          return;
        }
        resolve(context.createEvaluationResult(c));
      });
      if (!completion) surroundingAgent.resumeEvaluate();
    }
  });
  promise.then(() => {
    if (callOnFramePoppedLevel) {
      Assert(oldExecutionStack.length - callOnFramePoppedLevel === surroundingAgent.executionContextStack.length);
      for (const [newIndex, newStack] of surroundingAgent.executionContextStack.entries()) {
        Assert(newStack === oldExecutionStack[newIndex]);
      }
      surroundingAgent.executionContextStack.length = 0;
      for (const stack of oldExecutionStack) {
        surroundingAgent.executionContextStack.push(stack);
      }
    }
  }, (err): Protocol.Runtime.EvaluateResponse => {
    const expr = surroundingAgent.runningExecutionContext?.callSite.lastNode?.sourceText;
    const frame = InspectorContext.callSiteToCallFrame(captureStack().stack);
    // @ts-expect-error
    // eslint-disable-next-line no-console, @typescript-eslint/no-explicit-any
    declare const console: any;
    if (typeof console === 'object') console.error(err);
    inspectorContext.sendEvent['Runtime.exceptionThrown']({
      timestamp: Date.now(),
      exceptionDetails: {
        stackTrace: frame.length ? { callFrames: frame } : undefined,
        text: `engine262 error when evaluating the following node:\n\n    ${expr}\n\n${err.constructor.name}: ${err.message}\n${err.stack.slice(err.stack.indexOf(err.message) + err.message.length).split('\n').map((line: string) => `  ${line}`).join('\n')}\n\nFrom now on, the engine262 VM state is broken, please press the reload button.`,
        columnNumber: frame[0]?.columnNumber,
        lineNumber: frame[0]?.lineNumber,
        scriptId: frame[0]?.scriptId,
        url: frame[0]?.url,
        exceptionId: 0,
      },
    });
    return {
      result: { type: 'undefined' },
    };
  });
  return promise;
}

/** Whether a value is a promise, by its internal slot rather than by its shape. */
function isPromiseObject(value: Value): value is PromiseObject {
  return value instanceof ObjectValue && 'PromiseState' in value;
}

/**
 * Attach to `promise` and answer the inspector's response from how it settles: a
 * fulfilment through the ordinary result path, a rejection through
 * exceptionDetails so a failed `await` reads in the console as a thrown error
 * rather than as a returned rejected promise.
 *
 * The reactions are ordinary promise jobs on the agent's queue, so the host's
 * event loop is what runs them - the same loop that was already going to run
 * whatever the awaited work was waiting on.
 */
function settleThenResolve(
  realm: ManagedRealm,
  promise: PromiseObject,
  context: InspectorContext,
  resolve: (response: Protocol.Runtime.EvaluateResponse) => void,
): void {
  const onFulfilled = CreateBuiltinFunction(function* onFulfilledSteps(args: Arguments) {
    resolve(context.createEvaluationResult(NormalCompletion(args[0] ?? Value.undefined)));
    return Value.undefined;
  } as never, 1, Value(''), [], realm);
  const onRejected = CreateBuiltinFunction(function* onRejectedSteps(args: Arguments) {
    resolve(context.createEvaluationResult(ThrowCompletion(args[0] ?? Value.undefined)));
    return Value.undefined;
  } as never, 1, Value(''), [], realm);
  PerformPromiseThen(promise, onFulfilled, onRejected);
}
