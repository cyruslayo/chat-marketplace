# Classifier resource setting

The second bounded live benchmark hit the five-second classifier deadline on three turns.
It started six provider attempts and completed one of four benchmark stages.
The run created no prohibited effects.
Its failed report remains under `validation/benchmark-20261024T202834Z/`.

The public model catalogue reports these settings for `openai/gpt-6-luna`:

- Reasoning is optional.
- The default effort is `medium`.
- Supported efforts include `none`.

The saved metadata is `validation/2026-10-24/approved-model-reasoning.json`.
This observation does not prove that reasoning caused every timeout.

The closed classifier now requests `reasoningEffort: "none"` through the provider-neutral request port.
The OpenAI-compatible adapter maps this to `reasoning_effort: "none"`.
The five-second deadline and 512-token output bound remain unchanged.
Planning retains the existing provider reasoning settings.
The exact provider and model remain unchanged.
No account setting changed.

`AssistantRuntimeOptions.scopeReasoningEffort` accepts `none` or `provider_default`.
The default is `none` for this bounded classification task.
`provider_default` omits the preference.
The Gemini adapter retains its existing configuration.
No live Gemini call is required or authorized by this setting.

OpenRouter documents the optional parameter in its [parameter reference](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/parameters.mdx).
Its [reasoning guide](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx) explains effort controls and per-model metadata.

The focused classifier, adapter, quota, evaluator, and smoke gate passed 29 tests; exit 0.
The type check passed with no errors.
The adapter regression first failed before the field mapping was added.
All reports exclude prompts, responses, private guest details, and credentials.
Live acceptance must still verify classifier quality with this engineering setting.
