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

test('an unannotated const carries its initializer type', () => {
  expectInferred('const v = "s"; return v;');
  expectInferred('const c = new C(); return c.m();');
  expectInferred('const v = g(); return v;');
});

test('an unannotated let that is never assigned carries it too', () => {
  expectInferred('let v = "s"; return v;');
  expectInferred('let v = g(); return v;');
});

test('transparency reaches the shapes an ordinary body uses', () => {
  // A cast, a second hop, a nested block, and a closure capture. Each is an
  // unannotated local holding a value whose type is known.
  //
  // A local holding the PARAMETER is checked separately below, because
  // `const v = x; return v` returns a `number` at a `=> number` position and
  // being accepted there is correct - the first draft of this file asserted a
  // refusal for it and was simply wrong.
  expectInferred('const v = (1 := uint8); return v;');
  expectInferred('const a1 = g(); const b1 = a1; return b1;');
  expectInferred('{ const v = g(); return v; }');
  expectInferred('const v = g(); const h = () => v; return h();');
});

test('a local holding a typed parameter carries the PARAMETER\'s type', () => {
  // Not `number`: a `uint8` parameter read through an unannotated local
  // publishes `uint8`, which a `=> number` position refuses because numeric
  // types are invariant. The matching position is accepted.
  expectThrows('function f(x: uint8) { const v = x; return v; } const a: (x: uint8) => number = f;');
  expectOk('function f(x: uint8) { const v = x; return v; } const a: (x: uint8) => uint8 = f;');
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

test('an unannotated local reaches a typed position by the BOUNDARY, not statically', () => {
  // Measured while auditing the plan, and it is what rules out the larger fix.
  // These work because the binding is ~any~ and the boundary converts. Give the
  // binding its initializer's type and `number` is not assignable to `uint8`,
  // so both are refused - the visible/blind split of #sec-the-boundary-check
  // applied to every unannotated local at once.
  expect(value('function h(a: uint8) { return a; } const k = 3; `${h(k)}`;')).toBe('3');
  expect(value('function h(a: uint8) { return a; } const k = 3; let a: uint8 = k; `${a is uint8}`;')).toBe('true');
  // The out-of-range case is caught at RUN TIME, naming the value; a static rule
  // would have refused it before the program ran, as a written literal is
  // refused. That is the evidence the conversion is the boundary's, and that
  // #sec-static-type-of-an-expression's constant-propagation rule is not what
  // is running here.
  const late = run('function h(a: uint8) { return a; } const k = 300; h(k);') as unknown as {
    Type: string, Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> },
  };
  expect(late.Type).toBe('throw');
  let message = '';
  for (const [k, d] of late.Value.properties ?? []) {
    if (k.stringValue?.() === 'message') {
      message = d.Value?.stringValue?.() ?? '';
    }
  }
  expect(message).toContain('300');
  // A `let` behaves identically, though that rule excludes `let`.
  expect(value('let j = 3; let b: uint8 = j; `${b is uint8}`;')).toBe('true');
});

test('a const initialized with a literal publishes the widened type', () => {
  // `const K = 1; return K;` must publish `number`, exactly as `return 1` does.
  // The constant-propagation rule could be misread as giving `K` the literal
  // type, which would publish something no annotation can write.
  expectThrows(`${SETUP}function f(x: number) { const k = 1; return k; } const a: (x: number) => string = f;`);
  expectOk(`${SETUP}function f(x: number) { const k = 1; return k; } const a: (x: number) => number = f;`);
});

test('an annotation inside a binding pattern applies', () => {
  // Q2-pre. The design writes `let [a: uint8, b: uint8] = [1, 2]`, and the
  // annotation did NOTHING: no type, and no check either - a value out of range
  // bound, and a value of another type bound, where the same annotation on a
  // plain binding refuses both.
  expect(value('let [a: uint8] = [1]; `${a is uint8}`;')).toBe('true');
  expectThrows('let [a: uint8] = [300];');
  expectThrows('let [a: uint8] = ["s"];');
  expect(value('let [a: uint8, b: uint8] = [1, 2]; `${a is uint8}`;')).toBe('true');
  expect(value('let [a: uint8, ...[b: uint8]] = [1, 2]; `${a is uint8}`;')).toBe('true');
  // A default is converted at the position it fills, and a rest element still
  // collects the surplus.
  expect(value('let [a: uint8 = 5] = []; `${a is uint8}:${a}`;')).toBe('true:5');
  expect(value('let [a: uint8, ...rest] = [1, 2, 3]; `${a is uint8}:${rest.length}`;')).toBe('true:2');
  // A parameter's pattern element too, which had no boundary of its own: the
  // parameter check enforces the PARAMETER's type, and a pattern element is a
  // binding inside it.
  expect(value('function f([a: uint8]) { return a is uint8; } `${f([1])}`;')).toBe('true');
  expectThrows('function f([a: uint8]) { return a; } f([300]);');
});

test('a plain parameter keeps its own boundary, unchanged', () => {
  // The scope of the rule above. A plain formal parameter reaches the same
  // operation and is enforced by EnforceParameterTypes with the call's
  // type-parameter bindings in hand; enforcing it a second time refused
  // `function g<T extends []>(v: T)` for every argument, because `T` is unbound
  // at that point. Pattern elements are the case with no other boundary.
  expectThrows('function f(a: uint8) { return a; } f(300);');
  expectOk('function g<T extends []>(v: T): string { return "ok"; } const a: [].<number> = [1]; g(a);');
  expectOk('function g<T>(v: [].<T>) { return v[0]; } g(["a"]);');
});
