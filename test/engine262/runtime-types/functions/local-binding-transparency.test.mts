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

/** The message of the error _source_ produces. */
function thrownMessage(source: string): string {
  const completion = run(source) as unknown as {
    Type: string, Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> },
  };
  if (completion.Type !== 'throw') {
    throw new Error(`expected a throw completion for: ${source}`);
  }
  for (const [k, v] of completion.Value.properties ?? []) {
    if (k.stringValue?.() === 'message') {
      return v.Value?.stringValue?.() ?? '';
    }
  }
  return '';
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

const SETUP = 'class C { m(): string { return "s"; } } function g(): string { return "s"; } '
  + 'let outerArr: [].<uint8> = [1]; ';

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

test('a const numeric constant is judged where the literal would be', () => {
  // #sec-static-type-of-an-expression: a use of an unannotated `const` whose
  // initializer is a compile-time numeric constant "produces the value the
  // initializer would have produced had it been written at that position". The
  // rule was not implemented as a static one - the value reached the boundary
  // as ~any~ and was converted there, so an out-of-range constant reported at
  // RUN TIME where the written literal reports before the program runs. Now the
  // two agree.
  expect(value('function h(a: uint8) { return a; } const k = 3; `${h(k)}`;')).toBe('3');
  expect(value('const k = 3; let a: uint8 = k; `${a is uint8}`;')).toBe('true');
  expect(value('const K = 3.14; let a: float32 = K; `${a is float32}`;')).toBe('true');
  // Out of range, at a binding and at an argument, now refused early - the
  // message names a TYPE where it used to name the value.
  expect(thrownMessage('const k = 300; let a: uint8 = k;')).toContain('literal type');
  expect(thrownMessage('function h(a: uint8) { return a; } const k = 300; h(k);')).toContain('literal type');
  expect(thrownMessage('const k = 1.5; let a: uint8 = k;')).toContain('literal type');
  // A `let` is excluded by the clause - "a binding that may be reassigned must
  // have a type its assignments are checked against" - and its value still
  // reaches the boundary, which reports it there.
  expect(thrownMessage('let k = 300; let a: uint8 = k;')).toContain('300');
  // And a `const` whose initializer is not a constant expression is untouched.
  expect(thrownMessage('function g(): number { return 300; } const k = g(); let a: uint8 = k;')).toContain('300');
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

test('a destructured binding carries the type of its position', () => {
  // Q2a. A pattern binds names, and each takes the type of the position it
  // destructures: a property's type for an object pattern, the element type for
  // an array pattern, the positional type for a tuple. Same condition as a plain
  // local - a `const`, or a `let` this function never assigns - and the same
  // limit: the bindings get no type of their own, this answers what a
  // contribution reads.
  const obj = 'const o: { p: string } = { p: "s" }; ';
  expectInferred(`${obj}const { p } = o; return p;`);
  expectInferred(`${obj}const { p: q } = o; return q;`);
  // An array's element type, and a tuple read position-wise. The source is a
  // LOCAL here for the reason the test below records.
  expectInferred('let arr: [].<uint8> = [1]; const [e] = arr; return e;');
  expectInferred('let t: [uint8, string] = [1, "s"]; const [e0] = t; return e0;');
  expectInferred('let t2: [uint8, string] = [1, "s"]; const [e0, e1] = t2; return e1;');
});

test('destructuring transparency keeps the same guards', () => {
  // A destructured `let` that the function assigns publishes nothing, for the
  // reason a plain one does: the published type is enforced at the return.
  expectNotInferred('const o: { p: string } = { p: "s" }; let { p } = o; p = 5; return p;');
  // A source whose type is unknown yields nothing to read.
  expectNotInferred('function legacy() { return { p: "s" }; } const { p } = legacy(); return p;');
  // A DEFAULTED element is left alone in this phase: its type is the union of
  // the position's and the default's, and guessing at one of them would state
  // something the program does not.
  expectNotInferred('let t3: [uint8, string] = [1, "s"]; const [e0 = 5] = t3; return e0;');
});

test('an OUTER binding is not visible to the inference', () => {
  // A binding declared outside the function is invisible to the inference, so
  // anything read from it contributes nothing - while a FUNCTION declared
  // outside IS visible, because signatures are collected before publication and
  // bindings are not. That asymmetry is the evidence for the ordering.
  expectNotInferred('return outerArr[0];');
  expectNotInferred('const v = outerArr[0]; return v;');
  expectNotInferred('const [e] = outerArr; return e;');
  expectInferred('return g();');
});

test('what an attempt to fix the ordering must survive', () => {
  // Declaring the bindings before publication works and breaks two things, both
  // measured; recorded so the next attempt starts from them.
  //
  // (1) The declarations must not outlive the publication. Left in the frame,
  // a module-scope binding was seen where a function's own PARAMETER of the
  // same name shadows it - this program read the module's `a` and reported its
  // `length` type rather than the parameter's.
  expect(value('function f<N: uint32>(a: [N].<uint8>): uint32 { return a.length; }'
    + ' let a: [4].<uint8> = [7, 8, 9, 10]; `${Number(f.<4>(a))}`;')).toBe('4');
  // (2) Resolving an annotation early MEMOIZES what it resolves, and a type is
  // not COMPLETE until the walk has seen every declaration that adds to it.
  // Resolving `let m: I` before the walk reached `const k` cached an interface
  // record whose computed symbol key was unresolved, and the member stopped
  // being checked at all, silently - no error is reported, so rolling errors
  // back does not help.
  //
  // Restricting the pre-pass to annotations built from BUILTIN names does not
  // avoid it and makes it worse: `partial interface` extends exactly those
  // names, so `let m: ClassFieldMetadata` resolved early captures the record
  // before the partial declaration adds its member. The hazard is that the type
  // is completed later, not that the name is user-declared - which is why no
  // pre-pass is sound, and why the fix is to move PUBLICATION after a pass that
  // declares everything, rather than to move declarations earlier.
  const decl = 'const k = Symbol("k"); interface I { [k]: string; } ';
  expectThrows(`${decl}let m: I = { [k]: 5 };`);
  expectOk(`${decl}let m: I = { [k]: "ok" };`);
  expectThrows(`${decl}let m: I = { [k]: "ok" }; m[k] = 5;`);
});

test('an object literal initializer is read for the transparency', () => {
  // Q1b. `const o = { p: g() }; return o.p;` published nothing: an object
  // literal has no Static Type, so a local initialized with one had nothing to
  // read. With the object ANNOTATED the member read already carried its type,
  // so the gap was the literal.
  //
  // The shape is computed for the CONTRIBUTION only and is not given to the
  // literal as its Static Type - the array-literal cycle measured what typing
  // an expression form for every consumer costs, and this has one consumer.
  expectInferred('const o = { p: g() }; return o.p;');
  expectInferred('const o = { p: g(), q: 1 }; return o.p;');
  expectInferred('const o = { inner: { p: g() } }; return o.inner.p;');
  expectInferred('const o = { p: g() }; const { p } = o; return p;');
  // The typed own-property form states the member's type directly.
  expectInferred('const o = { (p: string): "s" }; return o.p;');
});

test('the object shape is conservative where it cannot read a member', () => {
  // A spread, a computed key, and a method each yield NOTHING rather than an
  // object type that omits what could not be read - such a type would describe
  // a value with fewer members than it has, and the contribution would state
  // it.
  expectNotInferred('const base = { p: g() }; const o = { ...base }; return o.p;');
  expectNotInferred('const k = "p"; const o = { [k]: g() }; return o.p;');
  expectNotInferred('const o = { m() { return g(); } }; return o.m();');
  // A `let` holding a literal that the function reassigns publishes nothing,
  // for the reason every other reassigned binding does.
  expectNotInferred('let o = { p: g() }; o = { p: 5 }; return o.p;');
});

test.fails('a parameter does not shadow an outer binding of the same name', () => {
  // Found by the two-pass experiment and PRE-EXISTING: with the binding declared
  // BEFORE the function, the parameter `a` does not shadow the module-scope `a`,
  // and the body reads the outer one - reporting its `length` type rather than
  // the parameter's. The suite does not see it because its own program declares
  // the binding after the function.
  //
  // The cause is that a parameter is bound by resolving its annotation, and an
  // annotation naming an unbound type parameter - `[N].<uint8>` - does not
  // resolve, so the name is never bound at all. The type is unknown; the
  // BINDING should not be optional.
  //
  // Binding it unconditionally is a two-line change and it exposes the layer
  // beneath: `a.length` on a value-generic `[N].<uint8>` types as `uint64`,
  // which the function's declared `: uint32` refuses. That assertion currently
  // passes only because the shadowing bug hands it a `[4].<uint8>` instead. Both
  // want fixing together.
  expect(value('let a: [4].<uint8> = [7, 8, 9, 10];'
    + ' function f<N: uint32>(a: [N].<uint8>): uint32 { return a.length; }'
    + ' `${Number(f.<4>(a))}`;')).toBe('4');
});
