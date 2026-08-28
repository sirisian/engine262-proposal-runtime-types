import { test, expect } from 'vitest';
import {
  evaluated, ok, expectThrown, expectErrorFlagOff, evaluatedFlagOff, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-type-annotations (Type Annotations) - rest parameters, and
 * #sec-bindarguments (BindArguments) for the binding half below.
 *
 * The design's rest parameters section (README) writes three things the base
 * grammar does not admit: a rest carrying a type, a rest followed by further
 * parameters, and more than one rest in a list. #sec-type-annotations
 * restates
 * BindingRestElement to carry a TypeAnnotation and FormalParameters so that a
 * rest is an ordinary element of the list.
 *
 * The first half of this file is about PARSING only - which run each rest
 * takes is SequenceAssignment's question - so the calls in it are written so
 * that the assignment is unambiguous under any rule. What they pin is that the
 * forms PARSE, that they parse in every position a parameter list appears, and
 * that the base language is untouched with the feature off.
 */

test('a rest parameter carries a type', () => {
  expect(evaluated('function f(a: string, ...args: [].<uint32>) { return args.length; } String(f("a", 1, 2));')).toBe('2');
  // The same annotation in a destructuring rest, which reaches its binding
  // through the same production and so was equally unparseable.
  expect(evaluated('let [a: uint8, ...b: [].<uint8>] = [1, 2, 3]; String(b.length);')).toBe('2');
});

test('a rest may be followed by further parameters', () => {
  expect(ok('function f(...a: [].<uint32>, b: string) { return b; }')).toBe(true);
  expect(ok('function f(a: uint8, ...b: [].<uint32>, c: string) { return c; }')).toBe(true);
});

test('a parameter list may hold more than one rest', () => {
  // The design's own example, README "Rest Parameters".
  expect(ok('function f(a: string, ...args: [].<uint32>, ...args2: [].<string>, callback: () => void) {}')).toBe(true);
  // Its worked one, whose binding SequenceAssignment settles.
  expect(ok('function f(...a: [].<uint32>, ...b: [].<uint32>, c: uint32): void {}')).toBe(true);
  // Untyped rests separated by typed parameters, also from that section. No
  // early error refuses these: under leftmost-greedy matching every list has a
  // determined assignment, so a list the design calls confusing is allowed and
  // discouraged rather than rejected.
  expect(ok('function f(...args1, callback1: () => void, ...args2, callback2: () => void) {}')).toBe(true);
});

test('every parameter position admits the new forms', () => {
  // A method, an accessor's owner, a class constructor, a generator, and an
  // async function all reach FormalParameters or UniqueFormalParameters, so a
  // regression in any of them would otherwise surface only in test262.
  expect(ok('class C { m(...a: [].<uint32>, b: string) { return b; } }')).toBe(true);
  expect(ok('class C { constructor(...a: [].<uint32>, b: string) {} }')).toBe(true);
  expect(ok('function* g(...a: [].<uint32>, b: string) { yield b; }')).toBe(true);
  expect(ok('async function h(...a: [].<uint32>, b: string) { return b; }')).toBe(true);
  expect(ok('const o = { m(...a: [].<uint32>, b: string) { return b; } };')).toBe(true);

  // Arrows come through the cover grammar and are refined afterwards, which is
  // a separate path. A TYPED rest never parsed there at any position before
  // this phase, so both halves are pinned.
  expect(ok('const g = (...a: [].<uint32>) => a.length;')).toBe(true);
  expect(ok('const g = (...a: [].<uint32>, b: string) => b;')).toBe(true);
  expect(ok('const g = (...a, b) => b;')).toBe(true);
});

test('a rest still may not carry an initializer', () => {
  // Unchanged from the base language, and the one early error the parser keeps.
  expect(ok('function f(...a = []) {}')).toBe(false);
});

test('the base language is untouched with the feature off', () => {
  // Everything the new grammar admits stays a Syntax Error without the feature,
  // which is what makes the change additive.
  expectErrorFlagOff('function f(...a, b) {}');
  expectErrorFlagOff('const g = (...a, b) => b;');
  expectErrorFlagOff('const g = (...a: uint8) => 1;');
  expectErrorFlagOff('function f(...a: [].<uint32>, ...b: [].<string>) {}');

  // And what the base language already accepted still runs, including a
  // call-site spread, which shares the `...` token and no longer shares a code
  // path with the parameter forms.
  expect(evaluatedFlagOff('function f(a, ...b) { return b.length; } String(f(1, 2, 3));')).toBe('2');
  expect(evaluatedFlagOff('const g = (...a) => a.length; String(g(1, 2));')).toBe('2');
  expect(evaluatedFlagOff('function f(a, b) { return a + b; } const xs = [1, 2]; String(f(...xs));')).toBe('3');
});

test('a call-site spread is unaffected by the parameter forms', () => {
  // `f(...xs)` and `function f(...xs: T)` share a token and nothing else; the
  // annotation is read in the parameter grammars, not in an argument list.
  expect(evaluated('function f(a: uint8, b: uint8) { return a + b; } const xs = [1, 2]; String(f(...xs));')).toBe('3');
});

// -- Binding a call ------------------------------------------------------------

/*
 * Binding a call: #sec-bindarguments.
 *
 * The forms parse and SequenceAssignment supplies the matcher; this binds a
 * call through it, on both sides:
 *
 * - the CHECKER, where viability was an arity count that assumed one trailing
 *   rest (#sec-resolveoverload), and
 * - the RUN TIME, where FunctionDeclarationInstantiation walks the argument
 *   iterator binding each parameter in turn, so a rest that is not last took a
 *   single argument like any other parameter (#sec-bindarguments).
 *
 * The runtime assignment runs over RUN-TIME types rather than the checker's
 * static ones, which is what a call arriving through `apply` or a spread of
 * unknown length needs; for a call the checker has accepted, the two agree.
 *
 * The design's three worked examples are the acceptance tests: they are what
 * the README prints, and an engine that does not reproduce them is wrong
 * whatever else it does.
 */

test('the README\'s worked binding, exactly', () => {
  // `f(...a, ...b, c)` called `f(0, 1, 2)` binds a to [0, 1], b to [], c to 2.
  // The first rest takes all three, the tail cannot be satisfied, it gives one
  // back, the second rest takes the remaining one and `c` cannot be satisfied,
  // it gives that back too, and the assignment settles.
  expect(evaluated(`
    function f(...a: [].<number>, ...b: [].<number>, c: number) {
      return a.length + "," + b.length + "," + c;
    }
    f(0, 1, 2);
  `)).toBe('2,0,2');
});

test('the types decide where one run ends and the next begins', () => {
  // `f(a: string, ...args, ...args2, callback)` with ('a', 0, 1, 2, 'a', 'b', fn).
  expect(evaluated(`
    function f(a: string, ...x: [].<number>, ...y: [].<string>, cb: () => void) {
      return x.length + "," + y.length;
    }
    f("a", 0, 1, 2, "a", "b", () => {});
  `)).toBe('3,2');
});

test('untyped rests are bounded by the typed parameters around them', () => {
  // The design once explained this with a rule that "dynamic types have less
  // precedence than typed parameters". No such rule exists: an untyped rest
  // admits everything, and a longer first run simply leaves no function for the
  // last parameter.
  expect(evaluated(`
    function f(...a1, cb1: () => void, ...a2, cb2: () => void) {
      return a1.length + "," + a2.length;
    }
    f("a", 1, 1.0, () => {}, "b", 2, 2.0, () => {});
  `)).toBe('3,3');
});

test('a rest gives back what the parameters after it require', () => {
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f(1, 2, "x");
  `)).toBe('2:x');

  // A rest that receives nothing is an empty array, not undefined.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f("x");
  `)).toBe('0:x');
});

test('a call no assignment satisfies is refused', () => {
  expectThrown('function f(...a: [].<number>, b: string) { return 1; } f("x", "y");');
});

test('the trailing-rest path is untouched', () => {
  // Every signature written before this feature takes the streaming walk and
  // never reaches the assignment. This is the hottest path in the engine and
  // the one place a mistake MISBINDS a program rather than rejecting it.
  expect(evaluated('function f(a: string, ...r: [].<number>) { return a + r.length; } f("a", 1, 2);')).toBe('a2');
  expect(evaluated('function f(a, ...r) { return r.length; } String(f(1, 2, 3));')).toBe('2');
  expect(evaluatedFlagOff('function f(a, ...r) { return r.length; } String(f(1, 2, 3));')).toBe('2');
});

test('every call form reaches the same binding', () => {
  const body = 'function f(...a: [].<number>, b: string) { return a.length + ":" + b; }';
  // A dynamically built argument list, which is the case the runtime
  // assignment exists for: the checker cannot see these lengths.
  expect(evaluated(`${body} f.apply(null, [1, 2, "x"]);`)).toBe('2:x');
  expect(evaluated(`${body} const xs = [1, 2, "x"]; f(...xs);`)).toBe('2:x');
  expect(evaluated('class C { m(...a: [].<number>, b: string) { return a.length + ":" + b; } } new C().m(1, 2, "x");')).toBe('2:x');
  expect(evaluated('function* g(...a: [].<number>, b: string) { yield a.length + ":" + b; } g(1, 2, "x").next().value;')).toBe('2:x');
  expect(evaluated('const g = (...a: [].<number>, b: string) => a.length + ":" + b; g(1, 2, "x");')).toBe('2:x');
});

test('arguments still holds every argument', () => {
  // The assignment distributes the arguments among the parameters; it does not
  // consume them. `arguments` is the call's own list and is unaffected.
  expect(evaluated('function f(...a: [].<number>, b: string) { return String(arguments.length); } f(1, 2, "x");')).toBe('3');
});

test('length counts the parameters before the first rest or default', () => {
  // A rest may now lead, and `Function.prototype.length` stops at it wherever
  // it sits rather than only at the last position.
  expect(evaluated('function f(...a: [].<number>, b: string) {} String(f.length);')).toBe('0');
  expect(evaluated('function f(a: number, ...b: [].<number>, c: string) {} String(f.length);')).toBe('1');
  expect(evaluated('function f(a: number, b: number) {} String(f.length);')).toBe('2');
  expect(evaluatedFlagOff('function f(a, ...b) {} String(f.length);')).toBe('1');
});

test('overload resolution admits a signature the assignment satisfies', () => {
  // Viability is now the assignment rather than an arity count, so a rest away
  // from the end no longer makes the parameter count an upper bound.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return "mid"; }
    f(1, 2, "x");
  `)).toBe('mid');

  // A signature matching on its fixed parameters is still preferred over one
  // matching only by absorbing arguments into a rest.
  expect(evaluated(`
    function f(a: number) { return "fixed"; }
    function f(...a: [].<number>) { return "rest"; }
    f(1);
  `)).toBe('fixed');
  expect(evaluated(`
    function f(a: number) { return "fixed"; }
    function f(...a: [].<number>) { return "rest"; }
    f(1, 2);
  `)).toBe('rest');
});

test('D39: a REST parameter no longer disables the whole signature', () => {
  // `check.mts` marked a signature unusable for any parameter that is not a
  // SingleNameBinding or BindingElement, with the reason "a rest or
  // destructuring parameter: no arity to check against". The consequence was
  // that ONE rest switched off argument checking for the entire call - the
  // FIXED parameters included.
  //
  // A rest DOES have an arity: #sec-type-annotations makes its annotation the
  // type of what it collects (D36).
  expectStaticTypeError('function f(...a: [].<uint8>) { return 1; } f("no");');
  expect(ok('if (false) { function f(...a: [].<uint8>) { return 1; } f((1 := uint8)); } 1;')).toBe(true);
  expect(ok('if (false) { function f(...a: [].<uint8>) { return 1; } f(); } 1;')).toBe(true);
  // The parameters BEFORE the rest were never the reason for the exclusion.
  expectStaticTypeError('function h(x: uint8, ...a: [].<uint8>) { return 1; } h("no");');
  expect(ok('if (false) { function h(x: uint8, ...a: [].<uint8>) { return 1; } h((1 := uint8)); } 1;')).toBe(true);
  // A DESTRUCTURING parameter is still excluded: it binds a pattern, not a name.
  expect(ok('if (false) { function d({ x }) { return 1; } d({ x: 1 }); } 1;')).toBe(true);
});

test('D39: arguments are mapped by the SAME operation the run time uses', () => {
  // This proposal allows NON-FINAL and MULTIPLE rests, so a positional walk over
  // parameters is wrong for both. `assignArguments` - which this file's overload
  // ranking already used, and which wraps the `SequenceAssignment` the run time
  // calls - does the mapping, and `slotReceiving` turns its COUNTS PER SLOT into
  // "which slot took this item". An earlier attempt indexed those counts as
  // though they were the slot map.
  //
  // These two answers are the specification of the mapping: a change that
  // refuses the wrong arguments above and breaks these has replaced one wrong
  // answer with another.
  expect(evaluated(`
    function f(...a: [].<number>, b: string) { return a.length + ":" + b; }
    f(1, 2, "x");
  `)).toBe('2:x');
  expect(evaluated(`
    function f(...a1, cb1: () => void, ...a2, cb2: () => void) {
      return a1.length + "," + a2.length;
    }
    f("a", 1, 1.0, () => {}, "b", 2, 2.0, () => {});
  `)).toBe('3,3');
});

test('D36: a rest annotation with an EXTENT fixes the argument count', () => {
  // #sec-type-annotations: "Where the annotation states an EXTENT - `[2].<uint8>`,
  // or `[N].<uint8>` for a value parameter N - the extent is part of the type and
  // the call must supply that many arguments".
  //
  // Checked at the CALL and not at the declaration: that is where the count is
  // knowable, and `assignArguments`' counts say how many the rest received.
  expectStaticTypeError('function f(...a: [2].<uint8>) { return 1; } f((1 := uint8));');
  expect(ok('if (false) { function f(...a: [2].<uint8>) { return 1; } f((1 := uint8), (2 := uint8)); } 1;')).toBe(true);
  expectStaticTypeError('function f(...a: [2].<uint8>) { return 1; } f((1 := uint8), (2 := uint8), (3 := uint8));');
  // A TUPLE rest fixes its arity the same way, and a trailing default lowers the
  // minimum as D33's length range says.
  expectStaticTypeError('function f(...a: [string, string]) { return 1; } f("a");');
  expect(ok('if (false) { function f(...a: [string, string]) { return 1; } f("a", "b"); } 1;')).toBe(true);
  // A DYNAMIC extent admits any count, which is the common case and must not
  // start being refused.
  expect(ok('if (false) { function f(...a: [].<uint8>) { return 1; } f((1 := uint8), (2 := uint8), (3 := uint8)); } 1;')).toBe(true);
  expect(ok('if (false) { function f(...a: [].<uint8>) { return 1; } f(); } 1;')).toBe(true);
});

test('D41: a rest parameter\'s ELEMENT type is enforced at run time', () => {
  // #sec-type-annotations: "A rest element's annotation is the type of what it
  // COLLECTS". A rest was the ONE position in the language whose declared type
  // the run time ignored - a fixed parameter, a binding's element and a field's
  // element all threw, and `...a: [].<uint32>` given a String did not.
  //
  // Called through an untyped binding so the CHECKER cannot fire: a static error
  // surfaces as a throw too, so the two are indistinguishable otherwise. That
  // confound is what hid this defect while two static checks were built on the
  // assumption the run time already enforced it.
  expectThrown('function f(...a: [].<uint32>) { return 1; } const g = f; g("no");', 'not assignable');
  expectThrown('function f(...a: [].<uint32>) { return 1; } const g = f; g((1 := uint32), "no");', 'not assignable');
});

test('D41: BINDING converts, it does not test membership', () => {
  // An untyped literal ADAPTS to a declared type, as it does for a fixed
  // parameter, so these are valid and must stay valid. A first attempt used
  // `IsOfType` - strict membership - and refused all of them.
  //
  // The ASSIGNED-PARAMETERS path does use `IsOfType`, because it is choosing
  // WHICH SLOT takes an argument. This path is binding one. The two questions
  // want different operations, and mirroring the wrong one was the error.
  expect(evaluated('function f(a: string, ...args: [].<uint32>) { return args.length; } String(f("a", 0, 1, 2, 3));')).toBe('4');
  expect(evaluated('function f(a: uint8, ...rest: [].<string>) { return rest[0]; } f((1 := uint8), "hello", "y");')).toBe('hello');
  // An UNTYPED rest is unaffected, and so are the multi-rest forms.
  expect(evaluated('function f(...a) { return a.length; } String(f("anything", 2));')).toBe('2');
  expect(evaluated(`
    function f(...a1, cb1: () => void, ...a2, cb2: () => void) {
      return a1.length + "," + a2.length;
    }
    f("a", 1, 1.0, () => {}, "b", 2, 2.0, () => {});
  `)).toBe('3,3');
  expect(evaluated('function f(...a: [].<number>, b: string) { return a.length + ":" + b; } f(1, 2, "x");')).toBe('2:x');
});
