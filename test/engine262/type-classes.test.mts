import { expect, test } from 'vitest';
import {  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

function makeRealm(runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  return new ManagedRealm();
}

function parseScript(source: string, runtimeTypes = true) {
  makeRealm(runtimeTypes);
  const p = new Parser({ source, specifier: 'classes-test' });
  const script = p.parseScript();
  if (p.earlyErrors.size > 0) {
    throw p.earlyErrors.values().next().value;
  }
  return script;
}

function statements(source: string, runtimeTypes = true) {
  const body = parseScript(source, runtimeTypes).ScriptBody;
  expect(body).toBeTruthy();
  return body ? body.StatementList : [];
}

function expectParseError(source: string, runtimeTypes = true) {
  expect(() => parseScript(source, runtimeTypes)).toThrow();
}

function classElements(source: string) {
  const decl = statements(source)[0] as { ClassTail?: { ClassBody?: readonly { type: string }[] | null } };
  return decl.ClassTail?.ClassBody ?? [];
}

test('class modifiers on declarations and expressions', () => {
  expect(statements('abstract class A {}')[0]).toMatchObject({
    type: 'ClassDeclaration', ClassModifiers: ['abstract'],
  });
  expect(statements('sealed class S {}')[0]).toMatchObject({ ClassModifiers: ['sealed'] });
  expect(statements('abstract dynamic class AD {}')[0]).toMatchObject({ ClassModifiers: ['abstract', 'dynamic'] });
  expect(statements('const C = abstract class {};')[0]).toMatchObject({
    BindingList: [{ Initializer: { type: 'ClassExpression', ClassModifiers: ['abstract'] } }],
  });
  expect(statements('class Plain {}')[0]).toMatchObject({ ClassModifiers: null });
  expectParseError('abstract abstract class X {}');
  expectParseError('sealed dynamic class X {}');
});

test('modifier words stay ordinary identifiers', () => {
  expect(statements('let abstract = 1; abstract + 1;')[1]).toMatchObject({ type: 'ExpressionStatement' });
  expect(statements('sealed(1);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('dynamic.x;')[0]).toMatchObject({ Expression: { type: 'MemberExpression' } });
});

test('implements clauses', () => {
  expect(statements('class C extends B implements I, J.K.<uint8> {}')[0]).toMatchObject({
    ClassTail: {
      ClassHeritage: { type: 'IdentifierReference' },
      ImplementsClause: [
        { type: 'TypeReference', TypeArguments: null },
        { type: 'TypeReference', TypeArguments: { type: 'TypeArguments' } },
      ],
    },
  });
  expect(statements('class C implements I {}')[0]).toMatchObject({
    ClassTail: { ClassHeritage: null, ImplementsClause: [{ type: 'TypeReference' }] },
  });
});

test('operator class elements', () => {
  const els = classElements(`class V {
    operator +(a, b): V { return a; }
    static operator ==(a, b);
    operator float32() { return 0; }
    * operator ...() { yield 1; }
  }`);
  expect(els.map((e) => e.type)).toEqual(['OperatorDefinition', 'OperatorDefinition', 'OperatorDefinition', 'OperatorDefinition']);
  expect(els[0]).toMatchObject({ OperatorName: '+', static: false, TypeAnnotation: { type: 'TypeAnnotation' } });
  expect(els[1]).toMatchObject({ OperatorName: '==', static: true, FunctionBody: null });
  expect(els[2]).toMatchObject({ OperatorName: null, Type: { type: 'TypeReference' } });
  expect(els[3]).toMatchObject({ OperatorGenerator: true });
});

test('elements named operator keep working', () => {
  expect(classElements('class W { operator() { return 1; } }')[0]).toMatchObject({
    type: 'MethodDefinition', ClassElementName: { name: 'operator' },
  });
  const fields = classElements('class W2 { operator = 5; static operator = 6; }');
  expect(fields[0]).toMatchObject({ type: 'FieldDefinition', ClassElementName: { name: 'operator' } });
  expect(fields[1]).toMatchObject({ type: 'FieldDefinition', static: true });
});

test('abstract methods', () => {
  const els = classElements(`abstract class B {
    abstract area(): float64;
    abstract offset(x, y);
    concrete() { return 1; }
  }`);
  expect(els[0]).toMatchObject({
    type: 'AbstractMethodDefinition',
    ClassElementName: { name: 'area' },
    UniqueFormalParameters: [],
    TypeAnnotation: { type: 'TypeAnnotation' },
  });
  expect(els[1]).toMatchObject({ type: 'AbstractMethodDefinition', TypeAnnotation: null });
  expect((els[1] as { UniqueFormalParameters?: readonly unknown[] }).UniqueFormalParameters).toHaveLength(2);
  expect(els[2]).toMatchObject({ type: 'MethodDefinition' });
  expectParseError('class P { abstract m(); }'); // placement: abstract class required
});

test('elements named abstract keep working', () => {
  const els = classElements('class Q { abstract() { return 1; } }');
  expect(els[0]).toMatchObject({ type: 'MethodDefinition', ClassElementName: { name: 'abstract' } });
  expect(classElements('class R { abstract = 2; }')[0]).toMatchObject({
    type: 'FieldDefinition', ClassElementName: { name: 'abstract' },
  });
});

test('classes with proposal elements still evaluate', () => {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger(`
    abstract class Shape {
      abstract area(): float64;
      operator ==(a, b) { return true; }
      m() { return 'ok'; }
    }
    // An abstract class cannot be instantiated directly (spec sec-abstract-classes),
    // so a concrete subclass exercises that the proposal elements evaluate.
    class Circle extends Shape {
      area() { return (1 := float64); }
    }
    new Circle().m();
  `);
  expect(completion).toMatchObject({ Type: 'normal' });
  const value = (completion as unknown as { Value: { stringValue(): string } }).Value;
  expect(value.stringValue()).toBe('ok');
});

test('feature off: modifier and element syntax stays an error', () => {
  expectParseError('abstract class A {}', false);
  expectParseError('class C implements I {}', false);
  expectParseError('class C { operator +(a, b) {} }', false);
  expectParseError('class C { abstract m(); }', false);
  expect(statements('class W { operator() { return 1; } }', false)[0]).toMatchObject({ type: 'ClassDeclaration' });
  expect(statements('sealed(1);', false)[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
});
