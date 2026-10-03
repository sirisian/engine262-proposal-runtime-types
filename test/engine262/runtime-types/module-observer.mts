import {
  Agent, ManagedRealm, setSurroundingAgent, FinishLoadingImportedModule, EnsureCompletion,
  ObjectValue, TypeDiagnosticOf, type TypeDiagnosticRecord, type Value,
} from '#self';

export interface ModuleObservation {
  status: 'fulfilled' | 'rejected';
  loaded: string[];
  bodyEntries: string[];
  errorClass?: string;
  diagnostic?: TypeDiagnosticRecord;
}

/** Observe unchanged module sources and require a settled evaluation callback. */
export async function observeModuleGraph(
  sources: Readonly<Record<string, string>>,
  entry = 'main',
  options: { runtimeTypes?: boolean; timeoutMs?: number } = {},
): Promise<ModuleObservation> {
  const agent = new Agent({ features: options.runtimeTypes === false ? [] : ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const modules = new Map<string, ReturnType<ManagedRealm['compileModule']>>();
  const bodies = new Map<object, string>();
  const loaded: string[] = [];
  const bodyEntries: string[] = [];
  const compile = (specifier: string) => {
    const cached = modules.get(specifier);
    if (cached) return cached;
    if (!Object.hasOwn(sources, specifier)) throw new Error(`Missing module fixture: ${specifier}`);
    loaded.push(specifier);
    const compiled = realm.compileModule(sources[specifier], { specifier });
    modules.set(specifier, compiled);
    if (compiled.Type === 'normal' && compiled.Value.ECMAScriptCode.ModuleBody) {
      bodies.set(compiled.Value.ECMAScriptCode.ModuleBody, specifier);
    }
    return compiled;
  };
  agent.hostDefinedOptions.hostHooks ??= {};
  agent.hostDefinedOptions.hostHooks.HostLoadImportedModule = (referrer, request, _hostDefined, payload) => {
    FinishLoadingImportedModule(referrer, request, payload, compile(request.Specifier));
  };
  agent.hostDefinedOptions.onNodeEvaluation = (node) => {
    const specifier = bodies.get(node);
    if (specifier !== undefined) bodyEntries.push(specifier);
  };
  const outcome = (status: ModuleObservation['status'], error?: Value): ModuleObservation => {
    const nativeErrors = ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError', 'StaticTypeError'] as const;
    const errorClass = error instanceof ObjectValue && 'Prototype' in error
      ? nativeErrors.find((name) => error.Prototype === realm.Intrinsics[`%${name}.prototype%`]) : undefined;
    return { status, loaded: [...loaded], bodyEntries: [...bodyEntries], errorClass, diagnostic: TypeDiagnosticOf(error) };
  };
  try {
    const compiled = compile(entry);
    if (compiled.Type === 'throw') return outcome('rejected', compiled.Value);
    let callbacks = 0;
    const result = await new Promise<ModuleObservation>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Module evaluation did not settle')), options.timeoutMs ?? 5000);
      try {
        realm.evaluateModule(compiled.Value, undefined, (value) => {
          clearTimeout(timer);
          try {
            if (++callbacks !== 1) throw new Error('Module completion callback ran more than once');
            const completion = EnsureCompletion(value);
            if (completion.Type === 'throw') { resolve(outcome('rejected', completion.Value)); return; }
            const promise = completion.Value;
            if (promise.PromiseState === 'pending') throw new Error('Module completion callback received a pending promise');
            if (promise.PromiseState !== 'fulfilled' && promise.PromiseState !== 'rejected') {
              throw new Error('Module completion callback did not receive a promise');
            }
            resolve(outcome(promise.PromiseState, promise.PromiseState === 'rejected' ? promise.PromiseResult : undefined));
          } catch (error) { reject(error); }
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    if (callbacks !== 1) throw new Error('Module completion callback ran more than once');
    return result;
  } finally {
    delete agent.hostDefinedOptions.onNodeEvaluation;
  }
}
