import { expect, test } from 'vitest';
import { evaluated, ok, expectThrown } from '../harness.mts';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-type-annotations (Type Annotations).
 *
 * Annotation placement across the binding and function forms - declarations,
 * for-of, parameters and returns, destructuring, arrows, class members,
 * object-literal methods - plus the arrow/conditional ambiguity, and proof
 * that with the feature off the annotation syntax stays an error.
 */

function parseScript(source: string, runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  void new ManagedRealm();
  const p = new Parser({ source, specifier: 'annotations-test' });
  const script = p.parseScript();
  if (p.earlyErrors.size > 0) {
    throw p.earlyErrors.values().next().value;
  }
  return script;
}

function firstStatement(source: string, runtimeTypes = true) {
  const body = parseScript(source, runtimeTypes).ScriptBody;
  expect(body).toBeTruthy();
  return body ? body.StatementList[0] : undefined;
}

function expectParseError(source: string, runtimeTypes = true) {
  expect(() => parseScript(source, runtimeTypes)).toThrow();
}

interface WalkableNode { readonly type: string }
function collect(value: unknown, type: string, out: WalkableNode[] = []): WalkableNode[] {
  if (Array.isArray(value)) {
    value.forEach((v) => collect(v, type, out));
  } else if (value && typeof value === 'object') {
    const node = value as WalkableNode & Record<string, unknown>;
    if (node.type === type) {
      out.push(node);
    }
    for (const key of Object.keys(node)) {
      if (key !== 'location') {
        collect(node[key], type, out);
      }
    }
  }
  return out;
}

test('lexical and variable declarations take annotations and typed initializers', () => {
  expect(firstStatement('let x: uint8 = 1;')).toMatchObject({
    type: 'LexicalDeclaration',
    BindingList: [{
      type: 'LexicalBinding',
      TypeAnnotation: { type: 'TypeAnnotation', Type: { type: 'TypeReference' } },
      Initializer: { type: 'NumericLiteral' },
    }],
  });
  expect(firstStatement('let y := 2;')).toMatchObject({
    BindingList: [{
      TypedInitializer: { type: 'TypedInitializer', AssignmentExpression: { type: 'NumericLiteral' } },
      Initializer: null,
    }],
  });
  expect(firstStatement('const c := 3;')).toMatchObject({
    BindingList: [{ TypedInitializer: { type: 'TypedInitializer' } }],
  });
  expect(firstStatement('var v: [].<uint8> = [];')).toMatchObject({
    type: 'VariableStatement',
    VariableDeclarationList: [{
      type: 'VariableDeclaration',
      TypeAnnotation: { Type: { type: 'ArrayType' } },
    }],
  });
  expect(firstStatement('var w := 4;')).toMatchObject({
    VariableDeclarationList: [{ TypedInitializer: { type: 'TypedInitializer' } }],
  });
  // `const` without an initializer is a Syntax Error only where the binding
  // carries NO annotation. #sec-lexical-declarations amends ECMA-262's early
  // error so it "does not apply to a LexicalBinding whose BindingIdentifier
  // carries one": such a binding takes the default value of its type, as a `let`
  // of that type does. This assertion read the unamended rule.
  expectParseError('const k;');
  expect(firstStatement('const k: uint8;')).toMatchObject({
    type: 'LexicalDeclaration',
    BindingList: [{ TypeAnnotation: { type: 'TypeAnnotation' }, Initializer: null }],
  });
});

test('for-of bindings take annotations', () => {
  const stmt = firstStatement('for (const e: uint8 of xs) {}');
  const bindings = collect(stmt, 'ForBinding');
  expect(bindings).toHaveLength(1);
  expect(bindings[0]).toMatchObject({ TypeAnnotation: { type: 'TypeAnnotation' } });
});

test('function declarations: parameter and return annotations, ref, optional', () => {
  expect(firstStatement('function f(a: uint8, ref b, c?: uint8 = 1): uint8 { return a; }')).toMatchObject({
    type: 'FunctionDeclaration',
    TypeAnnotation: { type: 'TypeAnnotation' },
    FormalParameters: [
      { type: 'SingleNameBinding', TypeAnnotation: { type: 'TypeAnnotation' } },
      { type: 'SingleNameBinding', Ref: true },
      {
        type: 'SingleNameBinding', Optional: true, TypeAnnotation: { type: 'TypeAnnotation' }, Initializer: { type: 'NumericLiteral' },
      },
    ],
  });
  expect(firstStatement('function f(ref) { return ref; }')).toMatchObject({
    FormalParameters: [{ type: 'SingleNameBinding', BindingIdentifier: { name: 'ref' } }],
  });
  expect(firstStatement('function* g(): uint8 {}')).toMatchObject({ type: 'GeneratorDeclaration', TypeAnnotation: { type: 'TypeAnnotation' } });
  expect(firstStatement('async function h(): uint8 {}')).toMatchObject({ type: 'AsyncFunctionDeclaration', TypeAnnotation: { type: 'TypeAnnotation' } });
});

test('destructuring bindings take optionals and annotations', () => {
  expect(firstStatement('let { a?: uint8, b: c } = o;')).toMatchObject({
    BindingList: [{
      BindingPattern: {
        type: 'ObjectBindingPattern',
        BindingPropertyList: [
          { type: 'SingleNameBinding', Optional: true, TypeAnnotation: { type: 'TypeAnnotation' } },
          { type: 'BindingProperty' },
        ],
      },
    }],
  });
  expect(firstStatement('let [d: uint8] = arr;')).toMatchObject({
    BindingList: [{
      BindingPattern: {
        type: 'ArrayBindingPattern',
        BindingElementList: [{ type: 'SingleNameBinding', TypeAnnotation: { type: 'TypeAnnotation' } }],
      },
    }],
  });
});

test('arrow functions: annotated parameters and return annotations', () => {
  expect(firstStatement('((a: uint8): uint8 => a);')).toMatchObject({
    Expression: {
      type: 'ParenthesizedExpression',
      Expression: {
        type: 'ArrowFunction',
        TypeAnnotation: { type: 'TypeAnnotation' },
        ArrowParameters: [{ type: 'SingleNameBinding', TypeAnnotation: { type: 'TypeAnnotation' } }],
      },
    },
  });
  expect(firstStatement('f = (): void => 1;')).toMatchObject({
    Expression: { AssignmentExpression: { type: 'ArrowFunction', TypeAnnotation: { Type: { type: 'PredefinedType' } } } },
  });
  expect(firstStatement('let f = x: uint8 => x;')).toMatchObject({
    BindingList: [{ Initializer: { type: 'ArrowFunction', TypeAnnotation: { type: 'TypeAnnotation' } } }],
  });
  expect(firstStatement('g = async (a): uint8 => a;')).toMatchObject({
    Expression: { AssignmentExpression: { type: 'AsyncArrowFunction', TypeAnnotation: { type: 'TypeAnnotation' } } },
  });
  expect(firstStatement('h = async x: uint8 => x;')).toMatchObject({
    Expression: { AssignmentExpression: { type: 'AsyncArrowFunction', TypeAnnotation: { type: 'TypeAnnotation' } } },
  });
});

test('conditional expressions keep their colons', () => {
  expect(firstStatement('c ? (a) : b;')).toMatchObject({
    Expression: { type: 'ConditionalExpression', AssignmentExpression_a: { type: 'ParenthesizedExpression' } },
  });
  // Valid today: the alternate is an arrow. The annotation reading must lose.
  expect(firstStatement('c ? (a) : b => c2;')).toMatchObject({
    Expression: { type: 'ConditionalExpression', AssignmentExpression_b: { type: 'ArrowFunction' } },
  });
  expect(firstStatement('c ? x : y;')).toMatchObject({ Expression: { type: 'ConditionalExpression' } });
  // Parenthesizing opts back in to the annotated arrow.
  expect(firstStatement('c ? ((a): uint8 => a) : f;')).toMatchObject({
    Expression: {
      type: 'ConditionalExpression',
      AssignmentExpression_a: { Expression: { type: 'ArrowFunction', TypeAnnotation: { type: 'TypeAnnotation' } } },
    },
  });
  // Call arguments reset the suppression.
  expect(firstStatement('c ? f(x: uint8 => x) : g;')).toMatchObject({
    Expression: { type: 'ConditionalExpression', AssignmentExpression_a: { type: 'CallExpression' } },
  });
  expect(firstStatement('(a ? b : c);')).toMatchObject({
    Expression: { type: 'ParenthesizedExpression', Expression: { type: 'ConditionalExpression' } },
  });
});

test('an annotated parameter list must become an arrow', () => {
  expectParseError('(a: uint8);');
  expectParseError('(a?: uint8);');
});

test('class fields and methods take annotations, setters excluded', () => {
  const stmt = firstStatement(`class C {
    x: uint8 = 1;
    static s: [].<uint8>;
    m(a: uint8): uint8 { return a; }
    get g(): uint8 { return 1; }
    set g(v: uint8) {}
  }`);
  const fields = collect(stmt, 'FieldDefinition');
  expect(fields).toHaveLength(2);
  expect(fields[0]).toMatchObject({ TypeAnnotation: { type: 'TypeAnnotation' }, Initializer: { type: 'NumericLiteral' } });
  expect(fields[1]).toMatchObject({ TypeAnnotation: { Type: { type: 'ArrayType' } } });
  const methods = collect(stmt, 'MethodDefinition');
  const annotated = methods.filter((m) => (m as { TypeAnnotation?: unknown }).TypeAnnotation);
  expect(annotated).toHaveLength(2); // m and the getter, not the setter
  expectParseError('class D { set s(v): uint8 {} }');
});

test('object literal methods take return annotations', () => {
  const stmt = firstStatement('({ m(): uint8 { return 1; } });');
  expect(collect(stmt, 'MethodDefinition')[0]).toMatchObject({ TypeAnnotation: { type: 'TypeAnnotation' } });
});

test('feature off: annotation syntax stays an error, conditionals unaffected', () => {
  expectParseError('let x: uint8 = 1;', false);
  expectParseError('let y := 2;', false);
  expectParseError('function f(): uint8 {}', false);
  expectParseError('f = (a): uint8 => a;', false);
  expectParseError('function f(ref b) {}', false);
  expect(firstStatement('c ? (a) : b => c2;', false)).toMatchObject({
    Expression: { type: 'ConditionalExpression', AssignmentExpression_b: { type: 'ArrowFunction' } },
  });
});

test('a destructured binding may carry a type annotation', () => {
  // OUTSTANDING item H. #sec-type-annotations, as amended:
  //   BindingElement : BindingPattern TypeAnnotation? Initializer?
  //
  // The rest form already admitted `...{ a, b }: T` and the non-rest form did
  // not - a distinction the grammar drew and nothing else did. It was the
  // largest single cause of syntax errors in the design corpus, 24 blocks, 19 of
  // them in `decorators.md`.
  const Point = 'type Point = { a: uint8, b: uint8 }; ';
  const obj = 'let o = {}; o.a = (1 := uint8); o.b = (2 := uint8); ';
  expect(evaluated(`${Point} ${obj} const { a }: Point = o; String(a);`)).toBe('1');
  expect(ok(`${Point} function f({ a, b }: Point) { return a; }`)).toBe(true);
  // The annotation types the value BEING destructured, so it is enforced before
  // the pattern takes names out of it - at the declaration site and at the
  // parameter site both. Parsing without enforcing would be the failure the
  // `where` work already met: written and silently ignored is worse than the
  // Syntax Error it replaced.
  expectThrown(`${Point} let bad = {}; bad.a = "no"; const { a }: Point = bad;`);
  expectThrown(`${Point} function f({ a }: Point) { return a; } let w = {}; w.a = "no"; f(w);`);
  // The rest form is untouched - spelled as a rest annotation has to be. A
  // rest's annotation is "the type of what it collects, an ~array~ or ~tuple~
  // type rather than an element type" (#sec-type-annotations), so the row here
  // used to write `...{ a }: Point` and assert it was accepted; the rest rule
  // refuses that at the declaration, and correctly. The destructuring pattern on
  // a rest is what this row is about, and it parses and types with the array
  // spelling.
  expect(ok(`${Point} function g(...{ a }: [].<Point>) { return a; }`)).toBe(true);
  expect(ok(`${Point} function g(...{ a }: Point) { return a; }`)).toBe(false);
});
