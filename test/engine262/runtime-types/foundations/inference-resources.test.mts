import { isDeepStrictEqual } from 'node:util';
import { expect, test } from 'vitest';
import { InferenceResources, type InferenceLimits } from '../../../../src/type-system/inference-limits.mts';
import type { Known } from '../../../../src/type-system/records.mts';
import type { ParseNode } from '../../../../src/parser/ParseNode.mts';
import { Agent, ManagedRealm, TypeDiagnosticOf, EnsureCompletion, setSurroundingAgent } from '#self';

const sameAnswer = (a: Known, b: Known) => isDeepStrictEqual(a, b);

function context(limits: InferenceLimits, enabled = true) {
  const agent = new Agent({ features: enabled ? ['runtime-types'] : [] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm({ returnInferenceBudget: limits } as never);
  let bodyEntered = false;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type === 'ScriptBody') bodyEntered = true;
  };
  const run = (source: string, forced = false) => {
    bodyEntered = false;
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source, { forceCheckedCode: forced }));
    return { completion: result.Type, diagnostic: TypeDiagnosticOf(result.Value), bodyEntered,
      value: (result.Value as { stringValue?: () => string }).stringValue?.() };
  };
  return { realm, run };
}

for (const kind of ['evaluations', 'results', 'depth'] as const) {
  test(`${kind} exhaustion is distinct from divergence and prevents body entry`, () => {
    const { run } = context({ [kind]: 0 });
    expect(run('function f(n:uint32){return n;} f(1);')).toMatchObject({
      completion: 'throw', bodyEntered: false,
      diagnostic: { code: 'RT_INFERENCE_LIMIT', rule: 'rt-inference-limit', phase: 'static' },
    });
    expect(run('"after";')).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'after' });
  });
}

test('finite projection can exhaust a small allowance and succeed with a larger one', () => {
  const nested = '{value:'.repeat(16) + 'node' + '}'.repeat(16);
  const source = `class Leaf { get value():Leaf { return this; } }
    function f(n:uint32,node:Leaf){return n>1?f(n,node).value:${nested};} "ok";`;
  const small = context({ results: 3 });
  expect(small.run(source)).toMatchObject({ completion: 'throw', bodyEntered: false,
    diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
  (small.realm.HostDefined as { returnInferenceBudget: InferenceLimits }).returnInferenceBudget = { results: 128 };
  expect(small.run(source)).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
});

test('an unproved growing component reports resource exhaustion without an invented result', () => {
  const { run } = context({ results: 4 });
  expect(run('function a(n:uint32){return [b(n-1)];} function b(n:uint32){return [a(n-1)];}')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
  expect(run('typeof a;')).toMatchObject({ completion: 'normal', value: 'undefined' });
});

test('a proved mutual constructor cycle retains its semantic diagnostic with bounded resources', () => {
  const { run } = context({ results: 4 });
  expect(run('function a(n:uint32){return [b(n)];} function b(n:uint32){return a(n);}')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_RETURN_INFERENCE' },
  });
  expect(run('typeof a + ":" + typeof b;')).toMatchObject({ completion: 'normal', value: 'undefined:undefined' });
  expect(run('function a(n:uint32){return n;} "ok";')).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('required dependency depth shares the source allowance', () => {
  const source = 'function a(n:uint32){return b(n);} function b(n:uint32){return c(n);} function c(n:uint32){return n;} "ok";';
  expect(context({ depth: 1 }).run(source)).toMatchObject({ completion: 'throw', diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
  expect(context({ depth: 8 }).run(source)).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('resource failure supersedes an incidental consumer mismatch', () => {
  expect(context({ results: 0 }).run('function f(n:uint32){return n;} const bad:string=f(0);')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
});

test('feature-disabled legacy code does not spend the inference allowance', () => {
  expect(context({ evaluations: 0 }, false).run('function f(){return 1;} "ok";')).toMatchObject({
    completion: 'normal', bodyEntered: true, value: 'ok', diagnostic: undefined,
  });
});

test('forced legacy checking uses the same resource-failure boundary', () => {
  expect(context({ evaluations: 0 }).run('function f(){return 1;} "ok";', true)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
});

test('exact allowances are usable and exhaustion remains sticky while unwinding', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  const resources = new InferenceResources({ evaluations: 2, results: 2, depth: 2 });
  expect(resources.enter(declaration)).toBe(true);
  expect(resources.enter(declaration)).toBe(true);
  const first = { Kind: 'union', Members: [] } as const;
  const second = { Kind: 'any' } as const;
  resources.result(declaration, 'return', first, sameAnswer);
  resources.result(declaration, 'return', second, sameAnswer);
  resources.result(declaration, 'return', first, sameAnswer);
  expect(resources.exhausted).toBeUndefined();
  resources.result(declaration, 'return', null, sameAnswer);
  expect(resources.exhausted?.kind).toBe('results');
  resources.leave();
  resources.leave();
  expect(resources.enter(declaration)).toBe(false);
  expect(resources.exhausted?.kind).toBe('results');
});

for (const value of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid inference limit ${value} cannot disable metering`, () => {
    expect(() => new InferenceResources({ evaluations: value })).toThrow(RangeError);
  });
}

test('yield and completion answers share a declaration allowance without sharing their component identity', () => {
  const declaration = { type: 'GeneratorDeclaration' } as ParseNode;
  const resources = new InferenceResources({ results: 1 });
  resources.result(declaration, 'yield', null, sameAnswer);
  resources.result(declaration, 'yield', null, sameAnswer);
  expect(resources.exhausted).toBeUndefined();
  resources.result(declaration, 'generator-return', null, sameAnswer);
  expect(resources.exhausted?.kind).toBe('results');
});

test('a mutable callable answer cannot rewrite previously charged results', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  const number = { Kind: 'primitive', Name: 'number', Arguments: [] } as const;
  const string = { Kind: 'primitive', Name: 'string', Arguments: [] } as const;
  const signature = { Parameters: [], Return: null, InferredReturn: number as Known };
  const answer = { Kind: 'array', Extent: 'dynamic', Element: { Kind: 'function', Signatures: [signature] } } as const;
  const resources = new InferenceResources({ results: 2 });
  resources.result(declaration, 'return', answer, sameAnswer);
  signature.InferredReturn = string;
  resources.result(declaration, 'return', answer, sameAnswer);
  signature.InferredReturn = number;
  resources.result(declaration, 'return', answer, sameAnswer);
  expect(resources.exhausted).toBeUndefined();
  signature.InferredReturn = { Kind: 'primitive', Name: 'boolean', Arguments: [] };
  resources.result(declaration, 'return', answer, sameAnswer);
  expect(resources.exhausted?.kind).toBe('results');
});

test('historical nominal answers preserve declaration and activation identities', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  const nominalDeclaration = { type: 'InterfaceDeclaration' } as ParseNode;
  const identity = {};
  const type = { Kind: 'nominal', Declaration: nominalDeclaration, DeclarationIdentity: identity, Arguments: [] } as const;
  const resources = new InferenceResources({ results: 1 });
  const sameIdentity = (a: Known, b: Known) => a?.Kind === 'nominal' && b?.Kind === 'nominal'
    && a.Declaration === b.Declaration && a.DeclarationIdentity === b.DeclarationIdentity
    && isDeepStrictEqual(a.Arguments, b.Arguments);
  resources.result(declaration, 'return', type, sameIdentity);
  resources.result(declaration, 'return', { ...type }, sameIdentity);
  expect(resources.exhausted).toBeUndefined();
  resources.result(declaration, 'return', { ...type, DeclarationIdentity: {} }, sameIdentity);
  expect(resources.exhausted?.kind).toBe('results');
});

test('historical deferred answers retain their environment identity', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  const type = { Kind: 'deferred', Operator: 'keyof', Operands: [], DefaultEnvironment: {} } as const;
  const resources = new InferenceResources({ results: 1 });
  const sameIdentity = (a: Known, b: Known) => a?.Kind === 'deferred' && b?.Kind === 'deferred'
    && a.Operator === b.Operator && a.DefaultEnvironment === b.DefaultEnvironment
    && isDeepStrictEqual(a.Operands, b.Operands);
  resources.result(declaration, 'return', type, sameIdentity);
  resources.result(declaration, 'return', { ...type }, sameIdentity);
  expect(resources.exhausted).toBeUndefined();
  resources.result(declaration, 'return', { ...type, DefaultEnvironment: {} }, sameIdentity);
  expect(resources.exhausted?.kind).toBe('results');
});

test('exhausted literal queries leave no declarations and a later check can succeed', () => {
  const { realm, run } = context({ results: 0 });
  expect(run('var f=(n:uint32)=>n;')).toMatchObject({ completion: 'throw', bodyEntered: false,
    diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
  expect(run('typeof f;')).toMatchObject({ completion: 'normal', value: 'undefined' });
  (realm.HostDefined as { returnInferenceBudget: InferenceLimits }).returnInferenceBudget = { results: 1 };
  expect(run('var f=(n:uint32)=>n; "ok";')).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('recording a deeply nested answer does not recurse on the native stack', () => {
  const declaration = { type: 'FunctionDeclaration' } as ParseNode;
  let answer: Known = { Kind: 'primitive', Name: 'number', Arguments: [] };
  for (let i = 0; i < 16000; i += 1) answer = { Kind: 'array', Extent: 'dynamic', Element: answer };
  const resources = new InferenceResources({ results: 1 });
  resources.result(declaration, 'return', answer, sameAnswer);
  expect(resources.exhausted).toBeUndefined();
});

for (const prefix of ['', 'async ']) {
  const expression = `${prefix}do * { yield (1 := uint8); return (2 := uint8); }`;
  const generator = prefix ? 'AsyncGenerator' : 'Generator';

  for (const kind of ['evaluations', 'results', 'depth'] as const) {
    test(`${prefix}do * observes zero ${kind} before body entry`, () => {
      expect(context({ [kind]: 0 }).run(`const values = ${expression}; "ok";`)).toMatchObject({
        completion: 'throw', bodyEntered: false,
        diagnostic: { code: 'RT_INFERENCE_LIMIT', rule: 'rt-inference-limit', phase: 'static' },
      });
    });
  }

  test(`${prefix}do * charges equal yield and completion types separately, once each`, () => {
    const source = `const values = ${expression}; "ok";`;
    expect(context({ results: 1 }).run(source)).toMatchObject({
      completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
    });
    expect(context({ results: 2 }).run(source)).toMatchObject({
      completion: 'normal', bodyEntered: true, value: 'ok', diagnostic: undefined,
    });
  });

  for (const body of ['', 'yield globalThis.unknown;', 'return globalThis.unknown;']) {
    test(`${prefix}do * accounts for empty and unknown components: ${body}`, () => {
      const source = `const values = ${prefix}do * { ${body} }; "ok";`;
      expect(context({ results: 1 }).run(source)).toMatchObject({
        completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
      });
      expect(context({ results: 2 }).run(source)).toMatchObject({ completion: 'normal', value: 'ok' });
    });
  }

  test(`${prefix}do * with contextual components checks operands without inferring them`, () => {
    const { run } = context({ evaluations: 0, results: 0, depth: 0 });
    expect(run(`const values: ${generator}.<uint8, uint8, void> = ${expression}; "ok";`)).toMatchObject({
      completion: 'normal', bodyEntered: true, value: 'ok', diagnostic: undefined,
    });
    expect(run(`const wrong: ${generator}.<uint8, void, void> = ${prefix}do * { yield "wrong"; };`)).toMatchObject({
      completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_ASSIGNABILITY' },
    });
  });

  test(`${prefix}do * restores the source boundary after exhaustion`, () => {
    const { realm, run } = context({ results: 0 });
    const source = `var values = ${expression}; "ok";`;
    expect(run(source)).toMatchObject({ completion: 'throw', bodyEntered: false,
      diagnostic: { code: 'RT_INFERENCE_LIMIT' } });
    expect(run('typeof values;')).toMatchObject({ completion: 'normal', value: 'undefined' });
    (realm.HostDefined as { returnInferenceBudget: InferenceLimits }).returnInferenceBudget = { results: 2 };
    expect(run(source)).toMatchObject({ completion: 'normal', bodyEntered: true, value: 'ok' });
  });

  test(`${prefix}do * completes a later capture within its two-answer allowance`, () => {
    const source = `const values = ${prefix}do * { yield later; return later; }; const later = (1 := uint8); "ok";`;
    expect(context({ results: 2 }).run(source)).toMatchObject({
      completion: 'normal', bodyEntered: true, value: 'ok', diagnostic: undefined,
    });
    expect(context({ results: 0 }).run(source)).toMatchObject({
      completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
    });
  });
}

test('nested generator expressions share the containing inference depth allowance', () => {
  const source = 'const values = do * { yield do * { yield (1 := uint8); }; }; "ok";';
  expect(context({ depth: 2 }).run(source)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
  expect(context({ depth: 4, results: 2 }).run(source)).toMatchObject({ completion: 'normal', value: 'ok' });
});

test('a contextual generator does not exempt nested function inference', () => {
  expect(context({ results: 0 }).run('const values: Generator.<uint8, void, void> = do * { function read(n:uint8) { return n; } yield read(1); };')).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
});

test('generator inference exhaustion precedes an incidental carrier mismatch', () => {
  const source = 'const wrong: string = do * { yield (1 := uint8); };';
  expect(context({ results: 0 }).run(source)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_INFERENCE_LIMIT' },
  });
  expect(context({ results: 2 }).run(source)).toMatchObject({
    completion: 'throw', bodyEntered: false, diagnostic: { code: 'RT_ASSIGNABILITY' },
  });
});
