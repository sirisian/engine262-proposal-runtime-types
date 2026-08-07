import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * The four decisions settled after the cycle-131 review, implemented together
 * because each is small and each closes a place where the engine and the design
 * disagreed or where a position was accepted and did nothing.
 */

const rejectionKind = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('DECISION 1: an operator return takes ClassOperatorReturn', () => {
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

test('DECISION 2: the layout reflection says which field it describes', () => {
  // `getReflection.<Reflect.ClassField, T>(name)` reported only layout numbers.
  // Redundant when fetched BY name, necessary when the set is enumerated -
  // which is the form that reads a whole layout out - and the design's
  // ClassFieldReflection lists `name` either way.
  expect(evaluated('class A { a: uint8; b: uint16; } String(Reflect.getReflection.<Reflect.ClassField, A>("b").name);')).toBe('b');
  // The bit-field surface stays where it is and is now documented as the
  // memory-layout extension's own reflection rather than left unwritten.
  expect(evaluated('class A { a: uint8; b: uint16; } Object.keys(Reflect.getReflection.<Reflect.ClassField, A>("b")).join(",");'))
    .toBe('kind,static,private,protected,name,offset,byteLength,bitLength,alignment,offsetBit,isBitField');
});

test('DECISION 3: a binding reflection reports `initial`, not `value`', () => {
  // The binding above is unannotated, so it reports no `type` - a member that
  // annotates nothing reports nothing rather than a type of `any`, which is how
  // the field and method contexts already read an absent annotation.
  //
  // decorators.md's LetReflection and ConstReflection both name this `initial`,
  // and the name is the accurate one: a decorator sees what the binding was
  // DECLARED with, not a live view. `value` implied a liveness the object never
  // had - a `let` reassigned later still reports what it started with.
  expect(evaluated('let f = ""; function g(c) { f = Object.getOwnPropertyNames(c).join(","); } @g let x = 41; f;')).toBe('kind,name,initializer,initial');
  expect(evaluated('let v; function g(c) { v = c.initial; } @g let x = 41; String(Number(v));')).toBe('41');
  expect(evaluated('let v; function g(c) { v = c.initial; } @g const y = 7; String(Number(v));')).toBe('7');
  // The reassignment case, which is what makes the name a claim rather than a
  // preference: the reflection keeps the declared value.
  expect(evaluated('let v; function g(c) { v = c.initial; } @g let x = 41; x = 99; String(Number(v)) + "/" + String(x);')).toBe('41/99');
});

test('DECISION 4: a decorator precedes a type only where the position has a context', () => {
  // §7.3 asked whether a `Reflect.Type` decoration exists and the design
  // answers no - "a bare type expression carries no decorator". The grammar had
  // been admitting one anywhere a type could be written and then DROPPING it,
  // which is the one answer nobody chose: it reads as support.
  //
  // The rule is positive rather than a list of exceptions: a RETURN is a
  // position with a reflection context, so it takes a decorator; a binding, a
  // field, a parameter, and an interface member are not, so they do not.
  expect(rejectionKind('function f(c) {} let x: @f uint8 = 1;')).toBe('SyntaxError');
  expect(rejectionKind('function f(c) {} const x: @f uint8 = 1;')).toBe('SyntaxError');
  expect(rejectionKind('function f(c) {} class A { a: @f uint8 = 1; }')).toBe('SyntaxError');
  expect(rejectionKind('function f(c) {} function g(p: @f uint8) {}')).toBe('SyntaxError');
  expect(rejectionKind('function f(c) {} interface I { a: @f uint8; }')).toBe('SyntaxError');
  expect(rejectionKind('function f(c) {} type T = @f uint8;')).toBe('SyntaxError');

  // AND THE FIVE RETURN POSITIONS STILL TAKE ONE, which is the half a refusal
  // is most likely to break. Each is a separate parser site, and the gate is
  // opened at each by hand - so each is asserted by hand.
  expect(rejectionKind('function f(c) {} class A { m(): @f uint8 { return 1; } }')).toBe('ACCEPTED');
  expect(rejectionKind('function f(c) {} class A { get x(): @f uint8 { return 1; } }')).toBe('ACCEPTED');
  expect(rejectionKind('function f(c) {} class O { operator +(r: O): @f O { return r; } }')).toBe('ACCEPTED');
  expect(rejectionKind('function f(c) {} abstract class A { abstract m(): @f uint8; }')).toBe('ACCEPTED');
  expect(rejectionKind('function f(c) {} function g(): @f uint8 { return 1; }')).toBe('ACCEPTED');
  expect(rejectionKind('function f(c) {} const o = { m(): @f uint8 { return 1; } };')).toBe('ACCEPTED');
  // A DECORATED position still has to FIRE, not merely parse - the refusal
  // above would look identical if the gate had closed the return sites too and
  // something else were accepting them.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } function g(): @f uint8 { return 1; } g(); k;')).toBe('FunctionReturn');
});

test('AND THE RULE MADE HONEST: a function\'s sub-targets fire on their own', () => {
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

test('an operator context says WHICH operator, and carries its type', () => {
  // proposal-runtime-types #sec-reflection-shape-class: ClassOperator reports
  // `operator`, `type`, and `signatures`. It reported none of the three - the
  // call site alone withheld the declaration node the other two are derived
  // from, and nothing read the operator name at all. An operator reflection
  // that cannot say which operator it is has lost what distinguishes it from a
  // method's.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.operator);`)).toBe('+');
  expect(evaluated(`${grab} class V { @f operator -(o: V): V { return o; } } String(c.operator);`)).toBe('-');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(typeof c.type);`)).toBe('object');
});

test('a binding context reports its declared type and its initializer', () => {
  // #sec-reflection-shape-binding gives Let and Const a `type` and an
  // `initializer` beside `initial`. They had neither, so a binding's decorator
  // could see what the binding started with and not what it was declared AS.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f let v: uint32 = 3; String(c.type === uint32);`)).toBe('true');
  expect(evaluated(`${grab} @f const k: string = "s"; String(c.type === string);`)).toBe('true');
  expect(evaluated(`${grab} @f let v: uint32 = 3; String(typeof c.initializer);`)).toBe('object');
  // An unannotated binding reports no type, rather than a type of `any`.
  expect(evaluated(`${grab} @f let u = 1; String(Object.getOwnPropertyNames(c).includes('type'));`)).toBe('false');
});

test('a function context reports its signatures', () => {
  // proposal-runtime-types #sec-reflection-shape-function: the Function
  // reflection is the ONE place the whole set of signatures is reachable - a
  // FunctionParameter context reflects the one signature its decoration was
  // written on. Without it an overloaded function reflected as though it had
  // one signature, and a reader had nowhere else to look.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f function q(a: uint8): uint8 { return a; } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} @f function q(a: uint8): uint8 { return a; } String(c.signatures[0].parameters.length);`)).toBe('1');
  expect(evaluated(`${grab} @f function q(): uint8 { return 1; } String(c.signatures[0].parameters.length);`)).toBe('0');
});

test('a loop block context carries its head clauses', () => {
  // proposal-runtime-types #sec-reflection-shape-block. The builder always
  // supported condition, initializer, and update; only `if` and `while` passed
  // them, so a do-while had no condition and a `for` had none of its three. A
  // for-of reflection that cannot say what it binds has lost what distinguishes
  // it from a bare block.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} let i = 0; do @f { i += 1; } while (i < 1); String(c.condition);`)).toBe('i < 1');
  expect(evaluated(`${grab} for (const v of [1]) @f { } String(c.binding);`)).toBe('const v');
  expect(evaluated(`${grab} for (const k in { a: 1 }) @f { } String(c.binding);`)).toBe('const k');
  // The head's three clauses sit in different slots depending on whether the
  // first is a declaration, so both shapes are pinned.
  expect(evaluated(`${grab} for (let i = 0; i < 1; i++) @f { } String(c.condition) + '/' + String(c.update);`)).toBe('i < 1/i++');
  expect(evaluated(`${grab} let j; for (j = 0; j < 1; j++) @f { } String(c.initializer) + '/' + String(c.condition);`)).toBe('j = 0/j < 1');
  // A clause the head omits reads undefined rather than being absent.
  expect(evaluated(`${grab} for (let i = 0; i < 1;) @f { i++; } String(c.update);`)).toBe('undefined');
});

test('an enum reports its size, and an enumerator its value and index', () => {
  // proposal-runtime-types #sec-reflection-shape-enum. The Enum context carried
  // only name, type, and metadata, and the enumerator carried a `type` that was
  // the enum's Type Object repeated once per member. An enumerator reflection
  // that cannot report its value has lost its subject.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} @f enum E { A, B, C } String(c.size);`)).toBe('3');
  expect(evaluated(`${grab} @f enum E { A } String(c.name);`)).toBe('E');
  expect(evaluated(`${grab} enum E { A, @f B } String(c.index);`)).toBe('1');
  expect(evaluated(`${grab} enum E { A, @f B } String(c.value);`)).toBe('1');
  // `index` is DECLARATION ORDER, which is not the value where a program
  // assigns values explicitly.
  expect(evaluated(`${grab} enum E { A = 10, @f B = 20 } String(c.index) + '/' + String(c.value);`)).toBe('1/20');
  // No `type` on an enumerator: it is the enum's, reached through the enum.
  expect(evaluated(`${grab} enum E { @f A } String(Object.getOwnPropertyNames(c).includes('type'));`)).toBe('false');
});

test('a Tuple or Record reflection is just its type', () => {
  // proposal-runtime-types #sec-reflection-shape-structural: these reflect a
  // composite VALUE where Reflect.Type reflects a type, and their whole shape is
  // `type` - no name, no metadata, the Structural family being one of those
  // sec-decorator-metadata gives none. They were being built by the object
  // member builder and carried all three.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const e = @f Composite([0]); Object.keys(c).sort().join(',');`)).toBe('kind,type');
  expect(evaluated(`${grab} const d = @f Composite({ a: 1 }); Object.keys(c).sort().join(',');`)).toBe('kind,type');
  // Which context fires is decided by the VALUE, not the syntax.
  expect(evaluated(`${grab} const e = @f Composite([0]); c.kind;`)).toBe('Tuple');
  expect(evaluated(`${grab} const d = @f Composite({ a: 1 }); c.kind;`)).toBe('Record');
});

test('an Object reflection has no name, and a setter parameter no index', () => {
  // An object literal has no name to report: the language names an anonymous
  // function or class from its binding and pointedly not an object literal, and
  // a name from the binding would report where the value went rather than what
  // it is. It read undefined in every position anyway.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = @f { a: 1 }; String(Object.getOwnPropertyNames(c).includes('name'));`)).toBe('false');
  // A setter takes exactly one parameter, so an index that is always 0 reports
  // nothing. Every other parameter reflection keeps its index.
  expect(evaluated(`${grab} class A { set v(@f x: uint8) {} } String(Object.getOwnPropertyNames(c).includes('index'));`)).toBe('false');
  expect(evaluated(`${grab} class A { m(@f x: uint8) {} } String(c.index);`)).toBe('0');
});

test('an object method, getter, and setter report their type', () => {
  // proposal-runtime-types #sec-reflection-shape-object: the family mirrors the
  // Class family member for member, and five of its nine contexts answered
  // nothing about what they hold - the builder took no declaration node, so it
  // could not read the annotation the Class family reads for the same shapes.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(typeof c.type);`)).toBe('object');
  expect(evaluated(`${grab} const o = { @f get v(): uint8 { return 1; } }; String(typeof c.type);`)).toBe('object');
  expect(evaluated(`${grab} const o = { @f set v(x: uint8) {} }; String(typeof c.type);`)).toBe('object');
  // An ObjectMethod reports its signatures, as a class method does.
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} const o = { @f m(x: uint8): uint8 { return x; } }; String(c.signatures[0].parameters.length);`)).toBe('1');
});

test('an object field reports the type of the value it holds', () => {
  // An object literal's field carries no annotation: `{ a: uint8 = 1 }` parses
  // as the property `a` holding the ASSIGNMENT EXPRESSION `uint8 = 1`, which is
  // why `{ a: uint8 = 300 }` stores 300 rather than refusing it. So the type a
  // field reports is the type of its value - the answer that suits a family
  // reached from an INSTANCE rather than from a declaration.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} const o = { @f a: "s" }; String(c.type === string);`)).toBe('true');
  expect(evaluated(`${grab} const o = { @f a: true }; String(c.type === boolean);`)).toBe('true');
  // A typed value keeps its type through the literal.
  expect(evaluated(`${grab} let v: uint8 = 3; const o = { @f a: v }; String(c.type === uint8);`)).toBe('true');
});

test('a getter and setter carry no `signatures`', () => {
  // #sec-reflection-shape-class gives `signatures` to a method and an operator
  // and not to a getter or setter: a getter has exactly one signature and takes
  // no parameters, so a List of one is ceremony rather than information, and
  // `type` already reports the function type.
  const grab = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${grab} class A { @f get v(): uint8 { return 1; } } String(Object.getOwnPropertyNames(c).includes('signatures'));`)).toBe('false');
  expect(evaluated(`${grab} class A { @f set v(x: uint8) {} } String(Object.getOwnPropertyNames(c).includes('signatures'));`)).toBe('false');
  // A method and an operator keep theirs.
  expect(evaluated(`${grab} class A { @f m(): uint8 { return 1; } } String(c.signatures.length);`)).toBe('1');
  expect(evaluated(`${grab} class V { @f operator +(o: V): V { return o; } } String(c.signatures.length);`)).toBe('1');
});
