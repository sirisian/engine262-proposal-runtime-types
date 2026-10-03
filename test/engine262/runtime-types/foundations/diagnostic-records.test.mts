import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, TypeDiagnosticOf, TypeDiagnosticCatalog } from '#self';

function diagnose(source: string) {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  let bodyRan = false;
  // Host observation leaves the source's effect and origin proofs unchanged.
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyRan = true;
  };
  const completion = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  return { completion, diagnostic: TypeDiagnosticOf(completion.Value), ran: String(bodyRan) };
}

test('narrowing diagnostics identify the rule and the deciding source expression', () => {
  const result = diagnose('function f(x: number) { if ([]) {} }');
  expect(result.ran).toBe('false');
  expect(result.diagnostic).toMatchObject({ code: 'RT_CONSTANT_CONDITION', rule: 'rt-constant-condition', phase: 'static', checked: true,
    location: { nodeType: 'ArrayLiteral' } });
  expect(Object.isFrozen(result.diagnostic)).toBe(true);
});

test('an unchecked source keeps its runtime call failure', () => {
  const result = diagnose('const f = 1; f();');
  expect(result.ran).toBe('true');
  expect(result.completion.Type).toBe('throw');
  expect(result.diagnostic).toBeUndefined();
});

test('a proposal binding contract is enforced without making its caller checked', () => {
  const result = diagnose('new uint8(1);');
  expect(result.ran).toBe('false');
  expect(result.diagnostic).toMatchObject({ code: 'RT_CONSTRUCTOR_REQUIRED', rule: 'rt-proposal-construction', checked: false });
});

test('a nested declared parameter contract remains mandatory for an unchecked caller', () => {
  const result = diagnose("function f(x: uint8) {} f('bad');");
  expect(result.ran).toBe('false');
  expect(result.diagnostic?.code).toBe('RT_ASSIGNABILITY');
});

test('a declared overload ambiguity remains mandatory for an unchecked caller', () => {
  const ordinary = diagnose('function f() { return 1; } function f() { return 2; } String(f());');
  expect(ordinary.completion.Type).toBe('normal');
  expect(ordinary.diagnostic).toBeUndefined();
  expect((ordinary.completion.Value as { stringValue(): string }).stringValue()).toBe('2');
  const result = diagnose('function f(x: uint8): uint8 { return x; } function f(x: uint8): string { return "s"; } f(uint8(1));');
  expect(result.ran).toBe('false');
  expect(result.diagnostic).toMatchObject({ code: 'RT_AMBIGUOUS_CALL', checked: false, applicability: 'always',
    location: { nodeType: 'CallExpression' } });
  expect(result.diagnostic?.related.some((location) => location.role === 'declaration')).toBe(true);
});

test('catalog rule identities are unique and codes may cover multiple applicability rules', () => {
  expect(new Set(TypeDiagnosticCatalog.map((entry) => entry.rule)).size).toBe(TypeDiagnosticCatalog.length);
  expect(TypeDiagnosticCatalog.filter((entry) => entry.code === 'RT_CONSTRUCTOR_REQUIRED').map((entry) => entry.applicability).sort())
    .toEqual(['always', 'checked']);
});

test('implicit hook calls distinguish non-callability from a declared parameter contract', () => {
  const noncallable = 'function target():{[Symbol.hasInstance]:number}{return {[Symbol.hasInstance]:1};}';
  const unchecked = 'function f(){({}) instanceof target();}';
  expect(diagnose(noncallable + unchecked).completion.Type).toBe('normal');
  const dynamic = diagnose(noncallable + unchecked + 'f();');
  expect(dynamic.completion.Type).toBe('throw');
  expect(dynamic.diagnostic).toBeUndefined();
  expect(dynamic.ran).toBe('true');
  expect(diagnose(noncallable + 'function f():void{({}) instanceof target();}').diagnostic)
    .toMatchObject({ rule: 'rt-instanceof-protocol', checked: true });
  const callable = 'function target():{[Symbol.hasInstance]:(x:number)=>boolean}'
    + '{return {[Symbol.hasInstance](x:number):boolean{return true;}};}';
  const contract = diagnose(callable + unchecked);
  expect(contract.ran).toBe('false');
  expect(contract.diagnostic).toMatchObject({ code: 'RT_INSTANCEOF_PROTOCOL', rule: 'rt-instanceof-declared-call',
    applicability: 'always', checked: false, location: { nodeType: 'RelationalExpression' } });
  expect(diagnose(callable + 'function f(){1 instanceof target();} f();').completion.Type).toBe('normal');
});

test('the formerly message-only Object.is diagnostic observes the checked boundary', () => {
  expect(diagnose("if (Object.is(1, 'a')) {};").ran).toBe('true');
  const result = diagnose("const x: uint8 = 1; if (Object.is(x, 'a')) {};");
  expect(result.ran).toBe('false');
  expect(result.diagnostic?.code).toBe('RT_DISJOINT_COMPARISON');
});

test('disjoint comparisons use the deciding unit, including switch labels', () => {
  expect(diagnose('function f() { return 1; } function g() { return "s"; } if (f() === g()) {}').diagnostic).toBeUndefined();
  const result = diagnose('function f(x: string) { switch (x) { case true: break; } }');
  expect(result.diagnostic).toMatchObject({ code: 'RT_DISJOINT_COMPARISON', checked: true,
    unit: { nodeType: 'FunctionDeclaration' }, location: { nodeType: 'CaseClause' } });
});

test('a checked nested destructuring obligation retains its own source unit', () => {
  const result = diagnose('function f(value: null) { const {} = value; }');
  expect(result.ran).toBe('false');
  expect(result.diagnostic).toMatchObject({ code: 'RT_PROPERTY_RECEIVER', checked: true,
    unit: { nodeType: 'FunctionDeclaration' } });
  expect(diagnose('function f() { const {} = null; }').diagnostic).toBeUndefined();
});

test('StaticTypeError has the specified native-error structure without a diagnostic property', () => {
  const result = diagnose(`const error = StaticTypeError('message', { cause: 42 });
    String(error instanceof Error) + ':' + String(error instanceof TypeError) + ':'
      + String(error instanceof SyntaxError) + ':' + String(Object.hasOwn(error, 'code')) + ':'
      + String(error.cause) + ':' + String(Object.getPrototypeOf(StaticTypeError) === Error);`);
  expect(result.completion.Type).toBe('normal');
  expect((result.completion.Value as { stringValue(): string }).stringValue()).toBe('true:false:false:false:42:true');
});
