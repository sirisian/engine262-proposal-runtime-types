# Runtime type checking tests

Run focused files with `node node_modules/vitest/vitest.mjs run <paths> --maxWorkers=2`. Build the engine after changing implementation sources. The proposal feature is enabled by default in this directory's shared helpers.

## Compare unchanged legacy source

`observeScript` from `harness.mts` evaluates the original source in a fresh realm:

```ts
const source = 'false();';
const legacy = observeScript(source, 'automatic');
const checked = observeScript(source, 'forced');
const featureOff = observeScript(source, 'disabled');

expect(legacy).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
expect(checked).toMatchObject({
  bodyEntered: false,
  errorClass: 'StaticTypeError',
  diagnostic: { rule: 'rt-not-callable', phase: 'static' },
});
```

| Mode | `runtime-types` feature | Checked-code applicability |
| --- | --- | --- |
| `automatic` (default) | Enabled | The specification's syntax and inheritance rules. |
| `forced` | Enabled | Explicitly mark this Script and its nested units checked. |
| `disabled` | Disabled | Ordinary ECMAScript; proposal syntax is unavailable. |

Typed source and other proposal syntax use `automatic`. Keep its compatibility tests: a successful forced rejection does not prove that ordinary legacy source should be rejected. Forcing applicability does not infer new declarations, change the source's grammar or strictness, or bypass the checker's existing proof requirements. An untyped binding may therefore still produce a runtime error in forced mode.

The host equivalent is `realm.compileScript(source, { forceCheckedCode: true })` or `realm.evaluateScriptSkipDebugger(source, { forceCheckedCode: true })`. The option is read when source is compiled and requires an agent with `runtime-types` enabled; it has no effect with the feature disabled. It is a testing/diagnostic extension, not an ECMAScript directive, CLI flag, realm-wide switch, or conformance requirement. Options supplied when evaluating an already compiled ScriptRecord do not recompile it. A subsequent compilation defaults to automatic classification. Direct eval inherits the checked caller; indirect eval and dynamically constructed functions classify their own source.

## Assert the phase as well as the error

`expectEarlyError(source, kind)` and `expectStaticTypeError(source)` assert both the native error prototype and rejection before ScriptBody entry. To force a legacy fixture, use `expectEarlyError(source, 'StaticTypeError', 'forced')`. These helpers do not prepend statements or wrap the source: directive prologues, hashbangs, scope and source offsets remain intact. The host observer cannot be reset by a source-level sentinel assignment.

`observeScript` reports `completion`, `bodyEntered`, `errorClass`, and the optional structured `diagnostic`. Error classification compares direct native prototypes without running source getters; custom errors and subclasses can have no `errorClass` and should be asserted through the raw completion when relevant. This is Script entry observation: a direct-eval failure after the outer ScriptBody starts has `bodyEntered: true`, even when the eval body never starts. Module dependencies, eval bodies and asynchronous settlement need their own boundary observations. Empty scripts have no ScriptBody to enter.

The shared helper checks synchronous Script outcomes. It does not drain asynchronous jobs or stand in for module/promise phase tests. Negative tests should assert a rule or diagnostic code where a specific rejection is intended; a generic throw alone can accept an unrelated parse or runtime error.

## Source fixtures

`conformance/boolean-flow.json` comes from the independent Boolean model in the specification repository. Its adapter runs the same expected judgments with automatic classification and checks unchecked neighbors with the feature on and off.

`conformance/legacy-script-outcomes.json` records unchanged JavaScript source and expected completion, body entry, error class, optional rule, and optional string result. Its automatic and disabled rows are compatibility evidence. Its forced rows are optional adapter probes and do not enlarge the proposal's mandatory rejection set. This corpus includes branches, loops, explicit constant-test exemptions, runtime exceptions, strict syntax, hashbangs and ordinary effects.
