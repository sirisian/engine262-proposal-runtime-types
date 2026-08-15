import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, ObjectValue, performDevtoolsEval, runSingleJobInQueue,
  setSurroundingAgent, skipDebugger, Value,
  AbruptCompletion, EnsureCompletion,
} from '#self';
import { Inspector } from '#self/inspector';

/**
 * The console evaluation path, src/host-defined/devtoolsEval.mts.
 *
 * It parses the source as a Script and, if that fails, re-parses it under
 * `{ await: true }` and evaluates the body under AsyncBlockStart - which is how
 * top-level await already works in the console. These tests cover what such an
 * evaluation ANSWERS, the completion value having been discarded before.
 */

function makeConsole() {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const drain = () => {
    let guard = 0;
    while (agent.jobQueue.length > 0) {
      guard += 1;
      expect(guard).toBeLessThan(1000);
      setSurroundingAgent(agent);
      runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {});
    }
  };
  /** Evaluate, drain, and answer the settled value however it was produced. */
  const evaluate = (source: string) => {
    const completion = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    drain();
    if (completion instanceof AbruptCompletion) {
      return { thrown: true, value: completion.Value as Value };
    }
    const value = completion.Value as Value;
    if (value instanceof ObjectValue && 'PromiseState' in value) {
      const promise = value as ObjectValue & { PromiseState: string, PromiseResult: Value };
      return { thrown: promise.PromiseState === 'rejected', value: promise.PromiseResult, wasPromise: true };
    }
    return { thrown: false, value, wasPromise: false };
  };
  // See harness.mts: a TypedNumberValue is not a NumberValue, so R throws.
  // eslint-disable-next-line @engine262/mathematical-value
  const numberOf = (v: Value) => (v as unknown as { numberValue(): number }).numberValue();
  const stringOf = (v: Value) => (v as unknown as { stringValue(): string }).stringValue();
  return { evaluate, numberOf, stringOf };
}

test('devtools eval: a synchronous body answers its completion value', () => {
  const c = makeConsole();
  const r = c.evaluate('7;');
  expect(r.wasPromise).toBe(false);
  expect(c.numberOf(r.value)).toBe(7);
});

test('devtools eval: an async body answers its completion value, not undefined', () => {
  // AsyncBlockStart resolves a NORMAL completion with undefined and a RETURN
  // completion with its value, which is right for an async function body -
  // falling off the end of one produces undefined. A REPL body is not that: its
  // completion value is the point. Before the body was handed over as a return
  // completion, every one of these answered undefined.
  const c = makeConsole();
  const trailing = c.evaluate('await 1; 42;');
  expect(trailing.wasPromise).toBe(true);
  expect(c.numberOf(trailing.value)).toBe(42);

  const bare = c.evaluate('await 42;');
  expect(c.numberOf(bare.value)).toBe(42);

  const str = c.evaluate('await 1; "hi";');
  expect(c.stringOf(str.value)).toBe('hi');
});

test('devtools eval: a declaration still has no completion value', () => {
  // A var declaration produces an empty completion, which becomes undefined -
  // the same answer the synchronous path gives, and not something the fix above
  // should have changed.
  const c = makeConsole();
  expect(c.evaluate('var declared = await 5;').value).toBe(Value.undefined);
  expect(c.evaluate('var plain = 5;').value).toBe(Value.undefined);
});

test('devtools eval: bindings survive an await into the next evaluation', () => {
  const c = makeConsole();
  expect(c.numberOf(c.evaluate('let bound = await 1; bound;').value)).toBe(1);
  expect(c.numberOf(c.evaluate('bound;').value)).toBe(1);
  expect(c.numberOf(c.evaluate('var v = await 5; 0;').value)).toBe(0);
  expect(c.numberOf(c.evaluate('v;').value)).toBe(5);
});

test('devtools eval: a rejected await rejects the answering promise', () => {
  const c = makeConsole();
  const r = c.evaluate('await Promise.reject(new TypeError("boom"));');
  expect(r.thrown).toBe(true);
});

/**
 * The Runtime.evaluate routing, lib-src/inspector/methods.mts.
 *
 * The devtools console sets `replMode: true` on every evaluation it makes and
 * does no rewriting of its own - it relies on the backend to accept top-level
 * await. Confirmed by reading the frontend the playground pins,
 * chrome-devtools-frontend@1.0.1656291: ConsoleModel.evaluateCommandInConsole
 * builds its options with `replMode: true` and passes `awaitPromise` false, and
 * the only rewriting anywhere is JavaScriptREPL.wrapObjectLiteral, which
 * parenthesizes object literals and returns everything else untouched.
 */

class TestInspector extends Inspector {
  readonly sent: { id?: number, method?: string, result?: unknown, params?: { context?: { uniqueId?: string } } }[] = [];

  protected send(data: object): void {
    this.sent.push(data);
  }

  request(id: number, method: string, params: unknown): void {
    this.onMessage(id, method, params);
  }
}

function makeInspector() {
  const agent = new Agent({ features: ['runtime-types'], eventLoopRunType: 'manual' });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const inspector = new TestInspector();
  inspector.attachAgent(agent, [realm]);
  inspector.request(0, 'Runtime.enable', {});
  inspector.request(0, 'Debugger.enable', {});
  const uniqueContextId = inspector.sent
    .find((m) => m.method === 'Runtime.executionContextCreated')?.params?.context?.uniqueId;
  expect(uniqueContextId).toBeDefined();

  const drain = () => {
    let guard = 0;
    while (agent.jobQueue.length > 0) {
      guard += 1;
      expect(guard).toBeLessThan(1000);
      setSurroundingAgent(agent);
      runSingleJobInQueue(agent.jobQueue.shift()!, () => {}, () => {});
    }
  };
  const evaluate = async (expression: string, extra: object = {}) => {
    inspector.sent.length = 0;
    inspector.request(1, 'Runtime.evaluate', { expression, uniqueContextId, ...extra });
    // The reply is delivered from a host promise that may itself await another,
    // so drain the agent and yield to the host loop until it appears.
    for (let turn = 0; turn < 50; turn += 1) {
      drain();
      const reply = inspector.sent.find((m) => m.id === 1);
      if (reply) {
        return reply.result as { result?: { type?: string, subtype?: string, value?: unknown }, exceptionDetails?: unknown };
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    return undefined;
  };
  return { evaluate };
}

test('Runtime.evaluate: without replMode, top-level await is still a syntax error', () => makeInspector().evaluate('await 1;').then((r) => {
  expect(r?.exceptionDetails).toBeDefined();
}));

test('Runtime.evaluate: replMode accepts top-level await', () => makeInspector().evaluate('await 1;', { replMode: true }).then((r) => {
  // That it EVALUATED rather than refusing. What it answers is pinned by the
  // settling tests below.
  expect(r?.exceptionDetails).toBeUndefined();
  expect(r?.result).toBeDefined();
}));

test('Runtime.evaluate: replMode leaves synchronous input alone', () => makeInspector().evaluate('6*7;', { replMode: true }).then((r) => {
  expect(r?.result?.type).toBe('number');
  expect(r?.result?.value).toBe(42);
}));

test('Runtime.evaluate: bindings from a replMode await persist to the next evaluation', async () => {
  const { evaluate } = makeInspector();
  await evaluate('let persisted = await 5; 0;', { replMode: true });
  const second = await evaluate('persisted;', { replMode: true });
  expect(second?.result?.value).toBe(5);
});

test('Runtime.evaluate: an async body is settled before the reply', async () => {
  // The frontend does not unwrap what the backend returns, so this is the
  // difference between `await 1;` reading as 1 and as `Promise {}`.
  const { evaluate } = makeInspector();
  const one = await evaluate('await 1;', { replMode: true });
  expect(one?.result?.type).toBe('number');
  expect(one?.result?.value).toBe(1);

  const chained = await evaluate('await Promise.resolve(7);', { replMode: true });
  expect(chained?.result?.value).toBe(7);
});

test('Runtime.evaluate: a synchronous body whose value is a promise stays a promise', async () => {
  // `Promise.resolve(1)` never awaited anything, and the user asked to see the
  // promise. Settling it because it happens to be one would answer 1 for an
  // expression that did not await - which is why the settling keys off whether
  // the BODY was async rather than off the shape of its value.
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(1);', { replMode: true });
  expect(r?.result?.subtype).toBe('promise');
});

test('Runtime.evaluate: a rejected await is reported as an exception', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('await Promise.reject(new TypeError("boom"));', { replMode: true });
  expect(r?.exceptionDetails).toBeDefined();
  expect(r?.result?.subtype).not.toBe('promise');
});

test('Runtime.evaluate: the reported callThread example reads back its value', async () => {
  const { evaluate } = makeInspector();
  await evaluate('let a: uint32 = 0; function A() { Atomics.add(ref a, 5); } 0;', { replMode: true });
  const awaited = await evaluate('await A.callThread();', { replMode: true });
  expect(awaited?.exceptionDetails).toBeUndefined();
  const read = await evaluate('a;', { replMode: true });
  expect(read?.result?.value).toBe(5);
});

// -- The edges ---------------------------------------------------------------
test('Runtime.evaluate: awaitPromise settles a promise result', async () => {
  // Distinct from the async-body settling above: here the body is synchronous
  // and its VALUE is a promise, which the caller has explicitly asked to have
  // settled. Before this the flag was refused outright with `unsupported`.
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(3);', { replMode: true, awaitPromise: true });
  expect(r?.result?.type).toBe('number');
  expect(r?.result?.value).toBe(3);
});

test('Runtime.evaluate: awaitPromise passes a non-promise straight through', async () => {
  // So a caller can set the flag unconditionally and never have two shapes of
  // response to reason about.
  const { evaluate } = makeInspector();
  const r = await evaluate('1;', { replMode: true, awaitPromise: true });
  expect(r?.result?.value).toBe(1);
});

test('Runtime.evaluate: awaitPromise reports a rejection as an exception', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.reject(new TypeError("r"));', { replMode: true, awaitPromise: true });
  expect(r?.exceptionDetails).toBeDefined();
});

test('Runtime.evaluate: without awaitPromise a promise result is still a promise', async () => {
  const { evaluate } = makeInspector();
  const r = await evaluate('Promise.resolve(3);', { replMode: true });
  expect(r?.result?.subtype).toBe('promise');
});

test('Runtime.evaluate: a preview does not leak the side effects of an awaited body', async () => {
  // A preview runs while the user is still typing, so it must not be observable.
  // It is already run under debugger_scopePreview, where promise jobs are not
  // enqueued and effects do not escape - which is why previews are left to
  // evaluate rather than made to refuse `await`: refusing would remove a working
  // preview to solve a problem the preview machinery already solves.
  const { evaluate } = makeInspector();
  await evaluate('globalThis.leaked = 1; await 1;', { replMode: true, throwOnSideEffect: true });
  const observed = await evaluate('String(globalThis.leaked);', { replMode: true });
  expect(observed?.result?.value).toBe('undefined');
});

// -- The static checker on the console path -------------------------------------
test('devtools eval: the static checker runs, as it does for a script', () => {
  // This path is a copy of PerformEval and had neither its check nor
  // ParseScript's, so nothing typed in the console was checked at all. A lexical
  // binding has no run-time typed-storage boundary to catch it afterwards, so
  // the omission did not soften the diagnosis - it removed it.
  const c = makeConsole();
  expect(c.evaluate("type Direction = 'north' | 'south' | 'east' | 'west';\nlet d: Direction = 'north';\nd = 0;").thrown).toBe(true);
  expect(c.evaluate('let a: uint8 = 0; a = 300;').thrown).toBe(true);
  expect(c.evaluate('let s: string = 1;').thrown).toBe(true);
});

test('devtools eval: a well-typed program is untouched', () => {
  const c = makeConsole();
  const r = c.evaluate("type D = 'n' | 's'; let d: D = 'n'; d = 's'; d;");
  expect(r.thrown).toBe(false);
  expect(c.stringOf(r.value)).toBe('s');
});

// -- The console is one session, not a sequence of programs ---------------------
//
// The checks this proposal inserts are STATIC, and a lexical binding has no
// run-time typed-storage boundary to catch what they miss - which is why the
// console runs the checker at all. Checking each entry in ISOLATION left the
// other half of the same hole: a console forgot every declared type at the entry
// boundary, so a session was an untyped dialect for anything spanning more than
// one line, while the same text in one entry was refused.
function makeSession() {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return (source: string): string => {
    const completion = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    if (completion instanceof AbruptCompletion) {
      return 'refused';
    }
    const value = completion.Value as unknown as { stringValue?(): string };
    return value?.stringValue?.() ?? 'ok';
  };
}

test('a declaration in one entry is checked against in the next', () => {
  const enumSwitch = makeSession();
  expect(enumSwitch('enum A { X, Y } let a: A = A.X; "d";')).toBe('d');
  // The reported case: with the entries separated, the discriminant had no enum
  // type and the exhaustiveness rule never applied.
  expect(enumSwitch('switch (a) { case A.X: "x"; break; }')).toBe('refused');

  const enumAssign = makeSession();
  expect(enumAssign('enum A { X, Y } let a: A = A.X; "d";')).toBe('d');
  expect(enumAssign('a = 5;')).toBe('refused');

  const width = makeSession();
  expect(width('let n: uint8 = 1; "d";')).toBe('d');
  expect(width('n = 300;')).toBe('refused');
});

test('what was already correct stays correct', () => {
  const ok = makeSession();
  expect(ok('let n: uint8 = 1; "d";')).toBe('d');
  expect(ok('n = 2; String(n);')).toBe('2');

  // A complete switch, and one with a default, are both accepted.
  const complete = makeSession();
  expect(complete('enum A { X, Y } let a: A = A.X; "d";')).toBe('d');
  expect(complete('switch (a) { case A.X: "x"; break; case A.Y: "y"; break; }')).toBe('x');
  const defaulted = makeSession();
  expect(defaulted('enum A { X, Y } let a: A = A.X; "d";')).toBe('d');
  expect(defaulted('switch (a) { case A.X: "x"; break; default: "o"; }')).toBe('x');

  // A `const` bound to a numeric constant is still one in a later entry, which
  // is what carrying constLiterals and declaredNames is for.
  const constant = makeSession();
  expect(constant('const K = 5; "k";')).toBe('k');
  expect(constant('let x: uint8 = K; String(x);')).toBe('5');
});

test('a console permits redeclaration, and the later type wins', () => {
  const c = makeSession();
  expect(c('let a = 1; "one";')).toBe('one');
  expect(c('let a = 2; "two";')).toBe('two');
  // Re-declaring at a different type replaces the recorded one.
  const retyped = makeSession();
  expect(retyped('let b: uint8 = 1; "one";')).toBe('one');
  expect(retyped('let b: string = "x"; "two";')).toBe('two');
  expect(retyped('b = 5;')).toBe('refused');
});

test('a rejected entry leaves nothing behind', () => {
  const c = makeSession();
  // Refused, so `n` is never declared and the session must not record it.
  expect(c('let n: uint8 = 300;')).toBe('refused');
  // An assignment to an undeclared name is an ordinary implicit global, not a
  // check against a type the rejected entry would have introduced.
  expect(c('n = 1; String(n);')).toBe('1');
});

test('two realms of one agent are two consoles', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const first = new ManagedRealm();
  const second = new ManagedRealm();
  const run = (realm: ManagedRealm, source: string) => {
    const completion = EnsureCompletion(skipDebugger(performDevtoolsEval(source, realm, false, true)));
    return completion instanceof AbruptCompletion ? 'refused' : 'ok';
  };
  // The same name at different types in each.
  expect(run(first, 'let n: uint8 = 1; "d";')).toBe('ok');
  expect(run(second, 'let n = 1; "d";')).toBe('ok');
  expect(run(first, 'n = 300;')).toBe('refused');
  expect(run(second, 'n = 300;')).toBe('ok');
});

// -- A console entry that declares an import ---------------------------------
//
// A static `import` is a Module production, so no script parse accepts it
// however it is parameterised - which is why this was a SyntaxError while
// top-level await was not: that path re-parses a SCRIPT with the await
// parameter, and there is no equivalent for a module declaration.
//
// It matters beyond convenience for a PREPROCESSOR import. #sec-expansion
// collects macro names from the parsed body's own imports and expands before
// evaluation, so a macro must be imported by the very unit that uses it; a
// dynamic import() resolves during evaluation, after expansion is over.

test('Runtime.evaluate: a console entry may declare an import', () => makeInspector()
  .evaluate('import { x } from "./nowhere.js";', { replMode: true })
  .then((r) => {
    // The specifier does not resolve in this harness, so what matters is that
    // the entry PARSED: a syntax error would name a token, and a load failure
    // names the module.
    const described = String((r as { exceptionDetails?: { exception?: { description?: string } } } | undefined)?.exceptionDetails?.exception?.description ?? '');
    expect(described).not.toContain('Unexpected token');
  }));

test('Runtime.evaluate: a preprocessor import parses too', () => makeInspector()
  .evaluate('import { jsx } from "./jsx.js" with { preprocessor: "true", mode: "jsx" };', { replMode: true })
  .then((r) => {
    const described = String((r as { exceptionDetails?: { exception?: { description?: string } } } | undefined)?.exceptionDetails?.exception?.description ?? '');
    expect(described).not.toContain('Unexpected token');
  }));

test('Runtime.evaluate: an ordinary entry still takes the script path', () => makeInspector()
  .evaluate('let importantValue = 1; importantValue + 1;', { replMode: true })
  .then((r) => {
    // A name merely CONTAINING "import" must not divert the entry, and a script
    // entry keeps its completion value - which a module entry would not have.
    expect(r?.result?.value).toBe(2);
  }));

test('Runtime.evaluate: top-level await is unaffected', () => makeInspector()
  .evaluate('await 1;', { replMode: true })
  .then((r) => {
    expect(r?.result?.value).toBe(1);
  }));

// -- An error with no call frames still says what happened -------------------
//
// The inspector describes an Error by its `stack`, and discards a stack with no
// "  at" frames. An error raised where no user code is running has none - a
// module that fails to load is raised by the LOADER, not by a call - so the
// description fell back to the bare class name and the console printed
// `Uncaught Error` with the reason visible only if the object was expanded.

test('Runtime.evaluate: a module that cannot load says so', () => makeInspector()
  .evaluate('import { x } from "nowhere.js";', { replMode: true })
  .then((r) => {
    const described = String((r as { exceptionDetails?: { exception?: { description?: string } } } | undefined)
      ?.exceptionDetails?.exception?.description ?? '');
    // Not the bare class name: this harness installs no module loader, so the
    // reason is that rather than a missing file - which is the point, since
    // either way the console now says something.
    expect(described).not.toBe('Error');
    expect(described).toContain('Error: ');
    expect(described.length).toBeGreaterThan('Error: '.length);
  }));

test('Runtime.evaluate: an ordinary thrown error is unchanged', () => makeInspector()
  .evaluate('throw new TypeError("boom");', { replMode: true })
  .then((r) => {
    const described = String((r as { exceptionDetails?: { exception?: { description?: string } } } | undefined)
      ?.exceptionDetails?.exception?.description ?? '');
    // This one HAS a stack, so the stack is still what is shown.
    expect(described).toContain('TypeError');
    expect(described).toContain('boom');
  }));
