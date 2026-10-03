import { afterEach, expect, test } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Value, ObjectValue, Throw, type OrdinaryObject,
  DeclarativeEnvironmentRecord, ModuleEnvironmentRecord, DeclarativeBindingIdentity, UninitializedBindingIdentity,
  BeginTypeDeclarationPreparation, IsPendingTypeDeclarationReference,
} from '#self';

let popContext: (() => void) | undefined;
afterEach(() => { popContext?.(); popContext = undefined; });

function setup() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  popContext = realm.pushTopContext();
  return { agent, realm };
}

function binding(environment = new DeclarativeEnvironmentRecord(null)) {
  const result = environment.CreateMutableBinding(Value('T'), Value.true);
  if (result && 'next' in result) expect(result.next().done).toBe(true);
  return environment;
}

function read(environment: DeclarativeEnvironmentRecord) {
  const result = environment.GetBindingValue(Value('T'), Value.true).next();
  if (!result.done) throw new Error('uninitialized read unexpectedly yielded');
  const completion = EnsureCompletion(result.value);
  expect(completion.Type).toBe('throw');
  return completion.Value;
}

test('same-spelled bindings, shadows and recreated bindings have distinct identities', () => {
  setup();
  const outer = binding();
  const inner = binding(new DeclarativeEnvironmentRecord(outer));
  const original = DeclarativeBindingIdentity(outer, Value('T'));
  expect(original).toBeDefined();
  expect(DeclarativeBindingIdentity(inner, Value('T'))).not.toBe(original);
  const empty = new DeclarativeEnvironmentRecord(outer);
  expect(DeclarativeBindingIdentity(empty, Value('T'))).toBeUndefined();
  expect(UninitializedBindingIdentity(read(outer))).toBe(original);
  outer.DeleteBinding(Value('T')).next();
  binding(outer);
  expect(DeclarativeBindingIdentity(outer, Value('T'))).not.toBe(original);
});

test('a global lexical binding uses its declarative holder identity', () => {
  const { realm } = setup();
  binding(realm.GlobalEnv.DeclarativeRecord);
  expect(DeclarativeBindingIdentity(realm.GlobalEnv, Value('T')))
    .toBe(DeclarativeBindingIdentity(realm.GlobalEnv.DeclarativeRecord, Value('T')));
  expect(DeclarativeBindingIdentity(realm.GlobalEnv, Value('Object'))).toBeUndefined();
});

test('only real binding reads carry evidence, independent of error wording and properties', () => {
  const { realm } = setup();
  const environment = binding();
  const error = read(environment) as ObjectValue;
  const identity = UninitializedBindingIdentity(error);
  expect(identity).toBe(DeclarativeBindingIdentity(environment, Value('T')));
  expect((error as OrdinaryObject).Prototype).toBe(realm.Intrinsics['%ReferenceError.prototype%']);
  const forged = Throw.ReferenceError('$1 cannot be used before initialization', Value('T'));
  expect([...error.properties.keys()]).toEqual([...(forged.Value as ObjectValue).properties.keys()]);
  error.properties.delete(Value('message'));
  expect(UninitializedBindingIdentity(error)).toBe(identity);
  expect(UninitializedBindingIdentity(forged.Value)).toBeUndefined();
  expect(UninitializedBindingIdentity(Value('T'))).toBeUndefined();
  const write = environment.SetMutableBinding(Value('T'), Value(1), Value.true).next();
  if (!write.done) throw new Error('uninitialized write unexpectedly yielded');
  expect(UninitializedBindingIdentity(EnsureCompletion(write.value).Value)).toBeUndefined();
});

test('indirect module reads identify the target binding, not the local import spelling', () => {
  const { realm } = setup();
  const target = new ModuleEnvironmentRecord(null);
  binding(target);
  const importer = new ModuleEnvironmentRecord(null);
  const parsed = realm.compileModule('export let T;');
  if (Array.isArray(parsed) || parsed.Type !== 'normal') throw new Error('module did not parse');
  const record = parsed.Value as { Environment: ModuleEnvironmentRecord | undefined };
  record.Environment = target;
  importer.CreateImportBinding(Value('T'), parsed.Value, Value('T'));
  expect(UninitializedBindingIdentity(read(importer))).toBe(DeclarativeBindingIdentity(target, Value('T')));
  expect(UninitializedBindingIdentity(read(importer))).not.toBe(DeclarativeBindingIdentity(importer, Value('T')));
  const unlinked = new ModuleEnvironmentRecord(null);
  record.Environment = undefined;
  unlinked.CreateImportBinding(Value('T'), parsed.Value, Value('T'));
  expect(UninitializedBindingIdentity(read(unlinked))).toBeUndefined();
});

test('nested groups suspend outer evidence and restore it on all exits', () => {
  setup();
  const outer = binding();
  const inner = binding();
  const outerError = read(outer);
  const innerError = read(inner);
  const endOuter = BeginTypeDeclarationPreparation(outer, ['T']);
  try {
    expect(IsPendingTypeDeclarationReference(outerError)).toBe(true);
    expect(IsPendingTypeDeclarationReference(innerError)).toBe(false);
    const endInner = BeginTypeDeclarationPreparation(inner, ['T']);
    try {
      expect(IsPendingTypeDeclarationReference(outerError)).toBe(false);
      expect(IsPendingTypeDeclarationReference(innerError)).toBe(true);
    } finally { endInner(); }
    expect(IsPendingTypeDeclarationReference(outerError)).toBe(true);
    expect(() => {
      const endEmpty = BeginTypeDeclarationPreparation(inner, []);
      try {
        expect(IsPendingTypeDeclarationReference(outerError)).toBe(false);
        throw new Error('host interruption');
      } finally { endEmpty(); }
    }).toThrow('host interruption');
    expect(IsPendingTypeDeclarationReference(outerError)).toBe(true);
  } finally { endOuter(); }
  expect(IsPendingTypeDeclarationReference(outerError)).toBe(false);
  expect(IsPendingTypeDeclarationReference(innerError)).toBe(false);
});

test('another agent cannot consult a suspended group', () => {
  const { agent } = setup();
  const environment = binding();
  const error = read(environment);
  const end = BeginTypeDeclarationPreparation(environment, ['T']);
  try {
    expect(IsPendingTypeDeclarationReference(error)).toBe(true);
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    expect(IsPendingTypeDeclarationReference(error)).toBe(false);
    setSurroundingAgent(agent);
    expect(IsPendingTypeDeclarationReference(error)).toBe(true);
  } finally { setSurroundingAgent(agent); end(); }
});

// Exercise the real checking wrapper, including its finally paths.
test.each(['success', 'exhaustion', 'host exception'])('source preparation restores the enclosing group after %s', (outcome) => {
  const { agent } = setup();
  const realm = new ManagedRealm(outcome === 'exhaustion' ? { typeEvaluationBudget: { steps: 100 } } as never : undefined);
  const outer = binding();
  const outerError = read(outer);
  const contextDepth = agent.executionContextStack.length;
  const endOuter = BeginTypeDeclarationPreparation(outer, ['T']);
  let pendingError: unknown;
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    if (node.type !== 'IdentifierReference' || pendingError !== undefined) return;
    pendingError = read(realm.GlobalEnv.DeclarativeRecord);
    expect(IsPendingTypeDeclarationReference(pendingError)).toBe(true);
    expect(IsPendingTypeDeclarationReference(outerError)).toBe(false);
    if (outcome === 'host exception') throw new Error('interrupted preparation');
  };
  const work = outcome === 'exhaustion' ? 'let n = 0; while (n < 1000) { n++; }' : '';
  const source = `function build(U: type): type { ${work} return U; } type T = build(uint8);`;
  try {
    if (outcome === 'host exception') {
      expect(() => realm.evaluateScriptSkipDebugger(source)).toThrow('interrupted preparation');
    } else {
      const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
      expect(result.Type).toBe(outcome === 'success' ? 'normal' : 'throw');
    }
    expect(pendingError).toBeDefined();
    expect(IsPendingTypeDeclarationReference(pendingError)).toBe(false);
    expect(IsPendingTypeDeclarationReference(outerError)).toBe(true);
  } finally {
    agent.hostDefinedOptions.onNodeEvaluation = undefined;
    endOuter();
    // A thrown host observer interrupts the public evaluator's context cleanup.
    // Restore the test harness after verifying preparation-state cleanup itself.
    while (agent.executionContextStack.length > contextDepth) {
      agent.executionContextStack.pop(agent.runningExecutionContext);
    }
  }
});
