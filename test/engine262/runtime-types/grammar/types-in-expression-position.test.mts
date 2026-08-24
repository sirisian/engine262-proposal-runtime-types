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
  // `(` is class 2 - ambiguous but resolvable by the token after `)` - and is
  // left to the call form until the cover grammar of
  // #sec-types-in-expression-position is built, so a call on an identifier
  // named `type` keeps working.
  expect(statements('type(1);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  // `[` is class 3: ambiguous with NO lookahead that separates the readings,
  // since `type [0]` is a complete tuple type and a complete member access that
  // end at the same token. The clause says "the only covered case is an operand
  // that begins with `(`", so `[` is not covered and belongs to the operator.
  expect(statements('type[0];')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'TupleType' } },
  });
  // The escape hatch for the value reading, which is what a program indexing a
  // binding named `type` writes.
  expect(statements('(type)[0];')[0]).toMatchObject({ Expression: { type: 'MemberExpression' } });
  // The operand forms `[` unlocks: tuple, dynamic array, fixed extent, empty.
  expect(statements('type [uint8];')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'TupleType' } },
  });
  expect(statements('type [].<uint8>;')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'ArrayType' } },
  });
  expect(statements('type [4].<uint8>;')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'ArrayType' } },
  });
  // An empty bracket pair is the EMPTY TUPLE. It used to be the array form, and
  // this assertion is the one that pinned it - PLAN-std-types.md F115 direction
  // B moved it, because `[]` in bound position was written zero times across
  // every design document while `[]` meaning the empty tuple was written about
  // thirty, and the empty tuple had no spelling at all. The array form keeps
  // `[].<T>`, and the family bound `[]` used to spell is now `[].<any>`.
  expect(statements('type [];')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'TupleType' } },
  });
  expect(statements('type [].<any>;')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'ArrayType' } },
  });
});

test('the type operator: `(` is refined by the token after the `)`', () => {
  // #sec-types-in-expression-position: "`type (uint8) => uint8` is a type
  // operator applied to a function type, while `type (x)` is a call of a
  // function named `type`, and the two agree until the token after the closing
  // parenthesis." The operand is parsed speculatively and kept only where it
  // came out a function type - that is, where a `=>` followed the `)`.
  for (const source of ['type (uint8) => uint8;', 'type (x: uint8) => uint8;', 'type () => void;']) {
    expect(statements(source)[0]).toMatchObject({
      Expression: { type: 'TypeOperatorExpression', Type: { type: 'FunctionType' } },
    });
  }
  // Everything the refinement declines stays a call, including the two that a
  // naive `(`-takes-the-operand rule would have broken: a named-argument call,
  // and a call whose argument is an arrow function.
  expect(statements('type(1);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('type (uint8);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('type (x: uint8);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  expect(statements('type ((x) => x);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  // A parenthesized non-function type is not one of the two refinements, so it
  // is a call too - the union spelling that needs no parentheses is the one the
  // operand reaches, `type A | B` being the union.
  expect(statements('type (uint8 | string);')[0]).toMatchObject({ Expression: { type: 'CallExpression' } });
  // In an EXPRESSION position: at statement start `type` followed by an
  // identifier is claimed by the declaration form, which is a separate lookahead.
  expect(statements('const u = type uint8 | string;')[0]).toMatchObject({
    BindingList: [{ Initializer: { type: 'TypeOperatorExpression', Type: { type: 'UnionType' } } }],
  });
  // The refinement runs only where the operator could apply at all: the
  // enclosing [no LineTerminator here] check is tested with `-` above.
});

test('the type operator: `-` is the other class 3 token', () => {
  // `-` was already decided in the operator's favour - `LiteralType : `-`
  // NumericLiteral` requires it - but nothing pinned that, which is how the
  // engine came to answer the two class 3 tokens differently. Both directions
  // are recorded here so the rule is visible rather than accidental.
  expect(statements('type -1;')[0]).toMatchObject({
    Expression: { type: 'TypeOperatorExpression', Type: { type: 'LiteralType' } },
  });
  // The value reading, through the escape hatch and through a property access,
  // which never reaches the operator at all.
  expect(statements('(type) - 1;')[0]).toMatchObject({ Expression: { type: 'AdditiveExpression' } });
  expect(statements('o.type - 1;')[0]).toMatchObject({ Expression: { type: 'AdditiveExpression' } });
  // A line terminator ends the operand's reach, so this stays subtraction.
  expect(statements('type\n- 1;')[0]).toMatchObject({ Expression: { type: 'AdditiveExpression' } });
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
