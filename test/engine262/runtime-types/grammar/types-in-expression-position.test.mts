import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-types-in-expression-position (Types in Expression Position).
 *
 * The expression-level forms: `is`, the typed conversion `:=`, the `type`
 * operator, type arguments on calls and members, and placement new -
 * parsed, evaluated, and shown to stay errors with the feature off.
 */

function makeRealm(runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  return new ManagedRealm();
}

function parseScript(source: string, runtimeTypes = true) {
  makeRealm(runtimeTypes);
  const p = new Parser({ source, specifier: 'expressions-test' });
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

function evaluated(source: string) {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value;
}

test('is expressions', () => {
  expect(statements('x is uint8;')[0]).toMatchObject({
    Expression: { type: 'IsExpression', Expression: { type: 'IdentifierReference' }, Type: { type: 'TypeReference' } },
  });
  expect(statements('a < b is bool;')[0]).toMatchObject({
    Expression: { type: 'IsExpression', Expression: { type: 'RelationalExpression' } },
  });
  expect(statements('let ok = v is [].<uint8>;')[0]).toMatchObject({
    BindingList: [{ Initializer: { type: 'IsExpression', Type: { type: 'ArrayType' } } }],
  });
  // The [no LineTerminator here] restriction keeps these two statements.
  const stmts = statements('x\nis;');
  expect(stmts).toHaveLength(2);
  expect(stmts[1]).toMatchObject({ Expression: { type: 'IdentifierReference', name: 'is' } });
});

test('typed conversion expressions', () => {
  expect(statements('x := uint8;')[0]).toMatchObject({
    Expression: { type: 'TypedConversionExpression', Type: { type: 'TypeReference' } },
  });
  // Left-associative chaining across the relational forms.
  expect(statements('a := uint8 is bool;')[0]).toMatchObject({
    Expression: { type: 'IsExpression', Expression: { type: 'TypedConversionExpression' } },
  });
  // Binding-level `:=` is still a TypedInitializer, not a conversion.
  expect(statements('let y := 2;')[0]).toMatchObject({
    BindingList: [{ TypedInitializer: { type: 'TypedInitializer' } }],
  });
});

test('the type operator', () => {
  // Upstream Arguments arrays carry an own `location`, which defeats array
  // subset matching, so the element is matched directly.
  const call = statements('f(type uint8);')[0] as { Expression?: { Arguments?: readonly { type: string }[] } };
  expect(call.Expression?.Arguments?.[0]).toMatchObject({ type: 'TypeOperatorExpression', Type: { type: 'TypeReference' } });
  expect(statements('const t = type Point.<uint8>;')[0]).toMatchObject({
    BindingList: [{ Initializer: { type: 'TypeOperatorExpression', Type: { TypeArguments: { type: 'TypeArguments' } } } }],
  });
  // Calls and member accesses on an identifier named `type` keep working.
  expect(statements('type(1);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('type[0];')[0]).toMatchObject({ Expression: { type: 'MemberExpression' } });
});

test('type arguments on calls and members', () => {
  expect(statements('f.<uint8>(1);')[0]).toMatchObject({
    Expression: {
      type: 'CallExpression',
      CallExpression: { type: 'TypeArgumentsExpression', Expression: { type: 'IdentifierReference' } },
    },
  });
  expect(statements('obj.m.<A, B>(x);')[0]).toMatchObject({
    Expression: { CallExpression: { type: 'TypeArgumentsExpression', Expression: { type: 'MemberExpression' } } },
  });
  expect(statements('new C.<T>(1);')[0]).toMatchObject({
    Expression: { type: 'NewExpression', MemberExpression: { type: 'TypeArgumentsExpression' } },
  });
  expect(statements('f(1).<T>;')[0]).toMatchObject({
    Expression: { type: 'TypeArgumentsExpression', Expression: { type: 'CallExpression' } },
  });
});

test('placement new', () => {
  expect(statements('new (buf) Point(1, 2);')[0]).toMatchObject({
    Expression: {
      type: 'NewExpression',
      PlacementArguments: [{ type: 'IdentifierReference' }],
      MemberExpression: { type: 'IdentifierReference', name: 'Point' },
    },
  });
  const two = statements('new (a, b) C();')[0] as { Expression?: { PlacementArguments?: readonly unknown[] } };
  expect(two.Expression?.PlacementArguments).toHaveLength(2);
  const three = statements('new (a, b, c) C(x);')[0] as { Expression?: { PlacementArguments?: readonly unknown[] } };
  expect(three.Expression?.PlacementArguments).toHaveLength(3);
  // Today's readings stay intact.
  expect(statements('new (Foo)(1);')[0]).toMatchObject({
    Expression: { type: 'NewExpression', PlacementArguments: null, MemberExpression: { type: 'ParenthesizedExpression' } },
  });
  expect(statements('new (getC()).x(1);')[0]).toMatchObject({
    Expression: { type: 'NewExpression', PlacementArguments: null, MemberExpression: { type: 'MemberExpression' } },
  });
  expectParseError('new (a, b, c, d) C(x);'); // more than three placement arguments
  expectParseError('new (buf) Point;'); // the placement form requires Arguments
});

test('expression evaluation', () => {
  expect(evaluated('const v = ("s" := string); v;').stringValue()).toBe('s');
  expect(evaluated('function f() { return "seven"; } f.<uint8>();').stringValue()).toBe('seven');
  expect(evaluated('((3 := uint8) is uint8) === true && (3 is uint8) === false && ("s" is uint8) === false ? "ok" : "no";').stringValue()).toBe('ok');
  expect(evaluated('const o = { m() { return this === o ? "bound" : "lost"; } }; o.m.<uint8>();').stringValue()).toBe('bound');
});

test('feature off: the expression forms stay errors', () => {
  expectParseError('x is uint8;', false);
  expectParseError('x := uint8;', false);
  expectParseError('f.<uint8>(1);', false);
  expectParseError('new (buf) Point(1);', false);
  expect(statements('type(1);', false)[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('new (Foo)(1);', false)[0]).toMatchObject({ Expression: { type: 'NewExpression' } });
  const stmts = statements('x\nis;', false);
  expect(stmts).toHaveLength(2);
});
