import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

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
  expectParseError('const k: uint8;'); // const still requires an initializer
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
