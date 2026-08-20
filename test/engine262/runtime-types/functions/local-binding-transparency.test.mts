import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-anchored-contributions, #sec-static-type-of-an-expression.
 *
 * An unannotated local binding stops an inference. `function f(x: number) {
 * const v = "s"; return v; }` publishes nothing, so
 * `const a: (x: number) => number = f` is accepted - while the same function
 * written `return "s"` is refused. Extracting a subexpression into a local is
 * the most ordinary refactor there is, and it silently drops the function's
 * type.
 *
 * The rule behind it is stated: an unannotated binding has the ~any~ Static
 * Type whatever its initializer, so the contribution is unknown and one unknown
 * contribution makes the join unknown. The fix is to read THROUGH a binding that
 * cannot change - which the specification already does for numeric constants,
 * in the sentence that says it "decides which VALUE a use produces" rather than
 * giving the binding a type.
 *
 * The guard that matters most is `a reassigned let must not publish`: reading an
 * initializer without establishing that the binding cannot change would turn a
 * working program into one that throws at its own return.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

function expectThrows(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

const SETUP = 'class C { m(): string { return "s"; } } function g(): string { return "s"; } ';

/** Assert that a body returning a string is REFUSED at a number-returning position. */
function expectInferred(body: string) {
  expectThrows(`${SETUP}function f(x: number) { ${body} } const a: (x: number) => number = f;`);
}

/** Assert that a body's type does NOT reach the position - the gap, or by design. */
function expectNotInferred(body: string) {
  expectOk(`${SETUP}function f(x: number) { ${body} } const a: (x: number) => number = f;`);
}

test('a returned expression carries its type', () => {
  // The rows that work, and the comparison that makes the gap visible: the same
  // value returned directly is refused.
  expectInferred('return "s";');
  expectInferred('return new C().m();');
  expectInferred('return g();');
});

test('an ANNOTATED local carries its type', () => {
  // #sec-anchored-contributions names "a binding's annotation" among the things
  // that anchor, and these have worked since that was implemented.
  expectInferred('const v: string = "s"; return v;');
  expectInferred('const c: C = new C(); return c.m();');
  expectInferred('let v: string = "s"; return v;');
});

test.fails('an unannotated const carries its initializer type', () => {
  expectInferred('const v = "s"; return v;');
  expectInferred('const c = new C(); return c.m();');
  expectInferred('const v = g(); return v;');
});

test.fails('an unannotated let that is never assigned carries it too', () => {
  expectInferred('let v = "s"; return v;');
  expectInferred('let v = g(); return v;');
});

test.fails('transparency reaches the shapes an ordinary body uses', () => {
  // A typed parameter, a cast, a second hop, a nested block, and a closure
  // capture. Each is an unannotated local holding a value whose type is known.
  expectInferred('const v = x; return v;');            // the parameter is a `number`... see below
  expectInferred('const v = (1 := uint8); return v;');
  expectInferred('const a1 = g(); const b1 = a1; return b1;');
  expectInferred('{ const v = g(); return v; }');
  expectInferred('const v = g(); const h = () => v; return h();');
});

test('a REASSIGNED let must not publish, and its program must still run', () => {
  // The guard. Reading an initializer without establishing that the binding
  // cannot change publishes `string` for a function that returns a number, and
  // a published type is enforced at the return - so this program, which runs
  // today, would throw. Whatever the fix reads, it must read nothing here.
  expectNotInferred('let v = g(); v = 5; return v;');
  expect(value(`${SETUP}function f(x: number) { let v = g(); v = 5; return v; } \`\${f(1)}\`;`)).toBe('5');
  // Assigned in a nested function, which is the case the elision rule's
  // mutation walk exists to catch.
  expectNotInferred('let v = g(); const set = () => { v = 5; }; set(); return v;');
});

test('the binding rule itself is unchanged', () => {
  // What transparency must NOT do. An unannotated binding keeps the ~any~ Static
  // Type: a wrong annotation over it is the boundary's business and names the
  // VALUE, not a type, and reflection reads the value.
  const wrong = run('const v = "s"; const n: number = v;') as unknown as {
    Type: string, Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> },
  };
  expect(wrong.Type).toBe('throw');
  let message = '';
  for (const [k, d] of wrong.Value.properties ?? []) {
    if (k.stringValue?.() === 'message') {
      message = d.Value?.stringValue?.() ?? '';
    }
  }
  expect(message).toContain('"s"');
  expect(value('const v = "s"; `${Reflect.typeOf(v) === string}`;')).toBe('true');
  expect(value('let v = "s"; v = 5; `${Reflect.typeOf(v) === number}`;')).toBe('true');
  // And literal propagation through an unannotated const still reaches a typed
  // position, which is the rule transparency generalizes rather than replaces.
  expect(value('function h(a: uint8) { return a; } const k = 1; `${h(k)}`;')).toBe('1');
});

test('a local whose initializer has no type stays unknown', () => {
  // Transparency yields nothing where there is nothing to read, so a legacy
  // helper still stops the inference - which is the participation rule working.
  expectNotInferred('const v = legacy(); return v;');
  expectNotInferred('return legacy();');
});

test.fails('a const initialized with a literal publishes the widened type', () => {
  // `const K = 1; return K;` must publish `number`, exactly as `return 1` does.
  // The constant-propagation rule could be misread as giving `K` the literal
  // type, which would publish something no annotation can write.
  expectThrows(`${SETUP}function f(x: number) { const k = 1; return k; } const a: (x: number) => string = f;`);
  expectOk(`${SETUP}function f(x: number) { const k = 1; return k; } const a: (x: number) => number = f;`);
});
