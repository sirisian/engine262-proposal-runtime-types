import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * The outcome of a program that may fail EARLY, through `eval` so the error
 * is catchable: 'ACCEPTED' where nothing threw, and the error's constructor
 * name otherwise.
 */
const acceptanceKind = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

/**
 * Spec: #sec-decorator-contexts (Decorator Contexts) - context coverage.
 *
 * 43 reflection contexts is too many to write 43 macros for and does not need
 * them. ONE macro reads what arrived; the matrix is one row per context.
 *
 * **The assertion is the KIND SEQUENCE, not the text** - a kind sequence is
 * stable against whitespace and says the tokenizer segmented correctly, where
 * asserting text would be testing `toString` instead.
 */

const COUNT = 'function count(c) { globalThis.__k = c.kind; '
  + 'globalThis.__t = c.block ? c.block.map(function (t) { return t.kind; }).join(",") : ""; } ';

const kindOf = (program: string): string => evaluated(`${COUNT}${program} globalThis.__k;`);

test('the CLASS family', () => {
  expect(kindOf('@count class A {}')).toBe('Class');
  expect(kindOf('class A { @count x: uint8 = 1; }')).toBe('ClassField');
  expect(kindOf('class A { @count m() {} }')).toBe('ClassMethod');
  expect(kindOf('class A { @count get g() { return 1; } }')).toBe('ClassGetter');
  expect(kindOf('class A { @count set s(v) {} }')).toBe('ClassSetter');
  expect(kindOf('class A { @count accessor a: uint8 = 1; }')).toBe('ClassAccessor');
});

test('the SUB-TARGET family - parameters and returns', () => {
  expect(kindOf('class A { m(@count x: uint8) {} }')).toBe('ClassMethodParameter');
  expect(kindOf('class A { m(): @count uint8 { return uint8(1); } }')).toBe('ClassMethodReturn');
  expect(kindOf('class A { get g(): @count uint8 { return uint8(1); } }')).toBe('ClassGetterReturn');
  expect(kindOf('class A { set s(@count v: uint8) {} }')).toBe('ClassSetterParameter');
});

test('the FUNCTION family', () => {
  expect(kindOf('@count function f() {}')).toBe('Function');
  expect(kindOf('function f(@count x: uint8) {}')).toBe('FunctionParameter');
  expect(kindOf('function f(): @count uint8 { return uint8(1); }')).toBe('FunctionReturn');
});

test('the DECLARATION family', () => {
  expect(kindOf('@count let x = 1;')).toBe('Let');
  expect(kindOf('@count const y = 1;')).toBe('Const');
  expect(kindOf('@count enum E { A }')).toBe('Enum');
});

test('the BLOCK family - all nine reachable forms', () => {
  // The decorator goes on the BLOCK, and the context is chosen by the block's
  // POSITION. That is why `IfBlockReflection` carries a `condition` the
  // decorator did not write.
  expect(kindOf('@count { let x = 1; }')).toBe('Block');
  expect(kindOf('if (true) @count { 1; }')).toBe('IfBlock');
  expect(kindOf('if (false) {} else @count { 1; }')).toBe('ElseBlock');
  expect(kindOf('if (false) {} else if (true) @count { 1; }')).toBe('ElseIfBlock');
  // A loop body's decorator does not run if the loop does not ENTER - a block
  // decorator fires per entry, so every loop row must actually iterate.
  expect(kindOf('let n = 0; while (n < 1) @count { n += 1; }')).toBe('WhileBlock');
  expect(kindOf('let n = 0; do @count { n += 1; } while (false);')).toBe('DoWhileBlock');
  expect(kindOf('for (let i = 0; i < 1; i++) @count { 1; }')).toBe('ForBlock');
  expect(kindOf('for (const k in { a: 1 }) @count { 1; }')).toBe('ForInBlock');
  expect(kindOf('for (const v of [1]) @count { 1; }')).toBe('ForOfBlock');
});

test('every block context receives its BLOCK as tokens', () => {
  // One assertion per shape rather than per form: the block is ONE group token,
  // so a macro cannot lose a brace whatever the enclosing statement was.
  expect(evaluated(`${COUNT}@count { let x = 1; } globalThis.__t;`)).toBe('group');
  expect(evaluated(`${COUNT}if (true) @count { 1; } globalThis.__t;`)).toBe('group');
  expect(evaluated(`${COUNT}for (const v of [1]) @count { 1; } globalThis.__t;`)).toBe('group');
});

// -- Annotating a decorator with its context -------------------------------------

/**
 * The kind a rejection carries, through `eval` so that an EARLY error is
 * catchable and its kind assertable - the harness's `expectThrownKind` cannot
 * reach one, because the script carrying its try/catch never runs.
 */
function rejectionKind(source: string): string {
  return evaluated(`try { eval(${JSON.stringify(source)}); "NO-THROW"; } catch (e) { e.constructor.name; }`);
}

/**
 * proposal-runtime-types #sec-decorator-application: "A decorator is an
 * ordinary function whose LAST PARAMETER IS ANNOTATED WITH A REFLECTION
 * CONTEXT."
 *
 * That form threw. Annotating a decorator's parameter with its context - the
 * form the clause defines, the form every example in decorators.md is written
 * in, and the form the clause's own dispatch rule reads to select among
 * declarations - failed with a ReferenceError as soon as the decorator ran. So
 * only an UNTYPED parameter worked, which is why every decorator test written
 * for stages A-G is written that way.
 *
 * THE CAUSE was one branch reached in the wrong order. A reflection context is
 * a ~nominal~ type carrying a [[LibraryName]], and the library branch of
 * IsOfType resolves a [[LibraryName]] as a GLOBAL BINDING - which is right for
 * `Map` and `Error`, whose values are instances of a global constructor, and a
 * ReferenceError for `Reflect.ClassField`, whose name is dotted and names no
 * binding at all. The contexts had resolved as values and as type ARGUMENTS
 * for four cycles; type-annotation position was the one that reached this.
 */

test('a decorator parameter annotated with its context works, at every family', () => {
  // The form the specification defines, at one context per family.
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassField) { k = String(c.name); } class A { @f a: uint8; } k;')).toBe('a');
  expect(evaluated('let k = "never"; function f(c: Reflect.Class) { k = String(c.name); } @f class Named {} k;')).toBe('Named');
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassMethod) { k = String(c.name); } class A { @f m() {} } k;')).toBe('m');
  expect(evaluated('let k = "never"; function f(c: Reflect.ClassMethodParameter) { k = String(c.index); } class A { m(@f p: uint8) {} } k;')).toBe('0');
  expect(evaluated('let k = "never"; function f(c: Reflect.Function) { k = String(c.name); } @f function fn() {} k;')).toBe('fn');
  expect(evaluated('let k = "never"; function f(c: Reflect.Let) { k = String(c.name); } @f let x = 1; k;')).toBe('x');
  expect(evaluated('let k = "never"; function f(c: Reflect.ObjectField) { k = String(c.name); } const o = { @f a: 1 }; k;')).toBe('a');
  expect(evaluated('let k = "never"; function f(c: Reflect.Enum) { k = String(c.name); } @f enum E { A } k;')).toBe('E');
  expect(evaluated('let k = "never"; function f(c: Reflect.Block) { k = c.kind; } @f { let a = 1; } k;')).toBe('Block');
});

test('the WRONG context is refused, and by the kind that says why', () => {
  // A decorator that fires with the wrong context still fires, so the
  // assertion that matters is that the wrong one is REFUSED - and by a kind
  // that says why. A
  // ReferenceError naming the context as an undefined binding, which reports a
  // missing global where the fact is a value of the wrong type.
  expectThrownKind('function f(c: Reflect.Class) {} class A { @f a: uint8; }', 'TypeError');
  expectThrownKind('function f(c: Reflect.ClassField) {} @f class A {}', 'TypeError');
  expectThrownKind('function f(c: Reflect.ClassGetter) {} class A { @f m() {} }', 'TypeError');
  // A sub-target's context is not its owner's.
  expectThrownKind('function f(c: Reflect.ClassMethod) {} class A { m(@f p: uint8) {} }', 'TypeError');
});

test('a reflection context is a STRUCTURAL type, as the design writes it', () => {
  // decorators.md writes every context as an object shape - `type
  // ClassFieldReflection = { ... }`, with `Reflect.ClassField` an interface
  // extending it - so membership reads the value's own discriminant rather
  // than a brand. `kind` is what every reflection object this engine builds
  // sets, and it is what the tests of stages A-G already read.
  expect(evaluated('let r = "?"; function f(c) { r = String(c is Reflect.ClassField); } class A { @f a: uint8; } r;')).toBe('true');
  expect(evaluated('let r = "?"; function f(c) { r = String(c is Reflect.Class); } class A { @f a: uint8; } r;')).toBe('false');
  // An object of the wrong shape is not of the type, so the judgment is doing
  // work rather than admitting any object.
  expectThrownKind('let x: Reflect.ClassField = { kind: "nope" };', 'TypeError');
  expectThrownKind('let x: Reflect.ClassField = 5;', 'TypeError');
  // `Reflect.Type` is the exception the design already names: it "is the one
  // reflection target that is not also a decorator context", and its
  // reflection is discriminated by the STRUCTURE it reports rather than by the
  // context's name, so its own name never appears in one.
  expect(evaluated('String(Reflect.getReflection.<Reflect.Type, uint8>() is Reflect.Type);')).toBe('true');
});

test('the library nominals this branch sits in front of are unaffected', () => {
  // The fix inserts a branch BEFORE the global-constructor lookup, so the
  // regression to watch is that lookup still deciding what it decided. `Error`,
  // `Map`, and the rest are nominal types whose values are instances of a
  // global, and they reach the branch below this one.
  expect(evaluated('let e: Error = new TypeError("x"); "ok";')).toBe('ok');
  expect(evaluated('let m: Map = new Map(); "ok";')).toBe('ok');
  expect(evaluated('let s: Set = new Set(); "ok";')).toBe('ok');
  expect(rejectionKind('let e: Error = 5;')).toBe('TypeError');
});

test('the rest of #sec-decorator-application', () => {
  // Both pieces this file pinned are done, and the pins are kept in flipped
  // form: the argument form is no longer a factory, and selection by context
  // type happens. decorator-calling-convention.test.mts owns the assertions;
  // what stays here is that a reader of the old pins finds the new answer.
  expect(evaluated('let got = "never"; function f(n: uint8, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); } class A { @f(7) a: uint8; } got;')).toBe('7:a');
  const decls = 'const l = []; function f(c: Reflect.ClassField) { l.push("field"); } function f(c: Reflect.Class) { l.push("class"); } ';
  expect(evaluated(`${decls} class A { @f a: uint8; } l.join(",");`)).toBe('field');
  expect(evaluated(`${decls} @f class N {} l.join(",");`)).toBe('class');
  // Ordinary overload resolution, unchanged throughout.
  expect(evaluated('function g(x: uint8) { return "u8"; } function g(x: string) { return "str"; } g("s") + "/" + g(1);')).toBe('str/u8');
});

// -- Selection by context type ---------------------------------------------------

/**
 * The third assertion: "it got the RIGHT CONTEXT".
 *
 * The family matrices assert that a decorator RAN and that it saw the right
 * name. They do not assert WHICH context it received, because the fixtures use
 * an untyped `function tag(n, c)` that accepts anything. Selection by context
 * these are the assertions that use it.
 *
 * The difference matters: "a decorator ran" and "the RIGHT decorator ran" are
 * different claims, and only the second catches a context being built for the
 * wrong position - which is the defect shape this plan has met most often.
 */

test('a decorator SELECTS on the context it is given', () => {
  // Two overloads of one name, one per context. Which one fires is the
  // assertion - an untyped decorator would have accepted either and told us
  // nothing.
  expect(evaluated('const l = []; '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } '
    + 'class A { @f a: uint8 = 1; @f m() {} } l.join(",");')).toBe('field,method');
});

test('each member position selects its OWN context, not a sibling\'s', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } '
    + 'function f(c: Reflect.ClassGetter) { l.push("getter"); } '
    + 'function f(c: Reflect.ClassSetter) { l.push("setter"); } '
    + 'function f(c: Reflect.ClassAccessor) { l.push("accessor"); } ';
  expect(evaluated(`${decls} class A { @f a: uint8 = 1; } l.join(",");`)).toBe('field');
  expect(evaluated(`${decls} class A { @f m() {} } l.join(",");`)).toBe('method');
  expect(evaluated(`${decls} class A { @f get g() { return 1; } } l.join(",");`)).toBe('getter');
  expect(evaluated(`${decls} class A { @f set s(v) {} } l.join(",");`)).toBe('setter');
  expect(evaluated(`${decls} class A { @f accessor c: uint8 = 1; } l.join(",");`)).toBe('accessor');
  // ALL FIVE in one class, in declaration order - the whole point of an
  // all-positions fixture, and safe here because each position is ALSO asserted
  // alone above. The caveat: a fixture that decorates every position at once
  // is structurally blind to "fires only when a sibling is decorated", so it
  // must be an ADDITION to per-position tests, never a replacement.
  expect(evaluated(`${decls} class A { @f a: uint8 = 1; @f m() {} @f get g() { return 1; } `
    + '@f set s(v) {} @f accessor c: uint8 = 1; } l.join(",");')).toBe('field,method,getter,setter,accessor');
});

test('a SUB-TARGET selects its own context too', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.ClassMethodParameter) { l.push("param"); } '
    + 'function f(c: Reflect.ClassMethodReturn) { l.push("return"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } ';
  expect(evaluated(`${decls} class A { m(@f x: uint8) {} } l.join(",");`)).toBe('param');
  expect(evaluated(`${decls} class A { m(): @f uint8 { return uint8(1); } } l.join(",");`)).toBe('return');
  // A method decorated ALONGSIDE its sub-targets fires all three, each with its
  // own context - which is the case A4 records as having hidden a defect for
  // eleven cycles, because a sub-target only fired when its OWNER was decorated.
  expect(evaluated(`${decls} class A { @f m(@f x: uint8): @f uint8 { return uint8(1); } } l.join(",");`))
    .toBe('param,return,method');
  // And the sub-targets fire when the owner is NOT decorated, which is the
  // assertion that defect would have failed.
  expect(evaluated(`${decls} class A { m(@f x: uint8): @f uint8 { return uint8(1); } } l.join(",");`))
    .toBe('param,return');
});

test('a CLASS and a FUNCTION select their own contexts', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.Class) { l.push("class"); } '
    + 'function f(c: Reflect.Function) { l.push("function"); } '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } ';
  expect(evaluated(`${decls} @f class A {} l.join(",");`)).toBe('class');
  expect(evaluated(`${decls} @f function h() {} l.join(",");`)).toBe('function');
  // A decorated class whose FIELD is also decorated fires both, members first -
  // decorators.md's ordering rule, asserted through context selection rather
  // than through a shared counter.
  expect(evaluated(`${decls} @f class A { @f a: uint8 = 1; } l.join(",");`)).toBe('field,class');
});

// -- Contexts that were missing, and the rule that selects them ------------------

test('an operator return takes ClassOperatorReturn', () => {
  // Every other callable member had a return context - ClassGetterReturn,
  // ClassMethodReturn, FunctionReturn, ObjectGetterReturn, ObjectMethodReturn.
  // The operator was the only one without, so C1 gave its return the METHOD
  // context, which made "decorate method returns but not operator returns"
  // unwriteable: a context IS the dispatch here.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } class O { operator +(r: O): @f O { return r; } } k;')).toBe('ClassOperatorReturn');
  expect(evaluated('typeof Reflect.ClassOperatorReturn;')).toBe('object');
  // THE ASSERTION THAT MATTERS is that the two are now SEPARABLE, which is the
  // whole reason for the context and is what a same-kind check would miss: one
  // decorator name, two declarations, and each return reaches its own.
  const both = 'const l = []; function f(c: Reflect.ClassMethodReturn) { l.push("method"); } '
    + 'function f(c: Reflect.ClassOperatorReturn) { l.push("operator"); } ';
  expect(evaluated(`${both} class O { m(): @f uint8 { return 1; } operator +(r: O): @f O { return r; } } l.join(",");`)).toBe('method,operator');
  // The neighbouring contexts are undisturbed.
  const k = 'let k = "NO"; function f(c) { k = c.kind; } ';
  expect(evaluated(`${k} class A { m(): @f uint8 { return 1; } } k;`)).toBe('ClassMethodReturn');
  expect(evaluated(`${k} class A { get x(): @f uint8 { return 1; } } k;`)).toBe('ClassGetterReturn');
  expect(evaluated(`${k} const o = { m(): @f uint8 { return 1; } }; k;`)).toBe('ObjectMethodReturn');
  // And it has a metadata interface, like every other context that carries
  // metadata: twenty-seven now rather than twenty-six.
  expect(evaluated('typeof ClassOperatorReturnMetadata;')).toBe('object');
});

test('a decorator precedes a type only where the position has a context', () => {
  // Whether a `Reflect.Type` decoration exists at all: the design answers no -
  // "a bare type expression carries no decorator". Admitting one anywhere a
  // type can be written and then DROPPING it is the one answer nobody chose,
  // because it reads as support.
  //
  // The rule is positive rather than a list of exceptions: a RETURN is a
  // position with a reflection context, so it takes a decorator; a binding, a
  // field, a parameter, and an interface member are not, so they do not.
  expect(acceptanceKind('function f(c) {} let x: @f uint8 = 1;')).toBe('SyntaxError');
  expect(acceptanceKind('function f(c) {} const x: @f uint8 = 1;')).toBe('SyntaxError');
  expect(acceptanceKind('function f(c) {} class A { a: @f uint8 = 1; }')).toBe('SyntaxError');
  expect(acceptanceKind('function f(c) {} function g(p: @f uint8) {}')).toBe('SyntaxError');
  expect(acceptanceKind('function f(c) {} interface I { a: @f uint8; }')).toBe('SyntaxError');
  expect(acceptanceKind('function f(c) {} type T = @f uint8;')).toBe('SyntaxError');

  // AND THE FIVE RETURN POSITIONS STILL TAKE ONE, which is the half a refusal
  // is most likely to break. Each is a separate parser site, and the gate is
  // opened at each by hand - so each is asserted by hand.
  expect(acceptanceKind('function f(c) {} class A { m(): @f uint8 { return 1; } }')).toBe('ACCEPTED');
  expect(acceptanceKind('function f(c) {} class A { get x(): @f uint8 { return 1; } }')).toBe('ACCEPTED');
  expect(acceptanceKind('function f(c) {} class O { operator +(r: O): @f O { return r; } }')).toBe('ACCEPTED');
  expect(acceptanceKind('function f(c) {} abstract class A { abstract m(): @f uint8; }')).toBe('ACCEPTED');
  expect(acceptanceKind('function f(c) {} function g(): @f uint8 { return 1; }')).toBe('ACCEPTED');
  expect(acceptanceKind('function f(c) {} const o = { m(): @f uint8 { return 1; } };')).toBe('ACCEPTED');
  // A DECORATED position still has to FIRE, not merely parse - the refusal
  // above would look identical if the gate had closed the return sites too and
  // something else were accepting them.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } function g(): @f uint8 { return 1; } g(); k;')).toBe('FunctionReturn');
});

test('a function\'s sub-targets fire on their own', () => {
  // Writing decision 4's assertions found that a plain function's parameter and
  // return decorations fired ONLY when the function itself was decorated - so
  // the rule "a decorator precedes a type where the position has a context" was
  // half true: `function g(): @f T` has a context and never reached it.
  //
  // The guard on the whole block was the function's own `Decorators`, and the
  // sub-target application sat inside it. A class method and an object method
  // never had this, because theirs run from ClassElementEvaluation, which does
  // not ask whether the member is decorated - the same one-of-two-entry-points
  // shape as the operator bug of C1.
  const tag = 'const l = []; function tag(n, c) { l.push(n + "(" + c.kind + ")"); } ';
  expect(evaluated(`${tag} function g(@tag("p") x: uint8): @tag("r") uint8 { return x; } l.join(",");`)).toBe('p(FunctionParameter),r(FunctionReturn)');
  // The function's OWN decoration is unchanged, and still last in the order.
  expect(evaluated(`${tag} @tag("fn") function g(@tag("p") x: uint8): @tag("r") uint8 { return x; } l.join(",");`)).toBe('p(FunctionParameter),r(FunctionReturn),fn(Function)');
  // A function with no decoration anywhere still does no decorator work, which
  // is what the guard is FOR - the fix must not make every function declaration
  // resolve its own binding.
  expect(evaluated(`${tag} function g(x: uint8) { return x; } String(l.length);`)).toBe('0');
});
