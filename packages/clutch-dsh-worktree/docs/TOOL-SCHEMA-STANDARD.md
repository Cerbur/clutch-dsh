# Agent tool schema and description standard

Research/review date: **2026-10-26**. Applies to every agent-facing tool in this
package, including conditional result reporting. Public tool names stay stable.
This is a conservative **author/native portability profile**, not a claim that all
providers implement the same JSON Schema dialect or that live E2E has passed.

## Official sources and scope of evidence

All four requested pages were read from their official HTTPS hosts. The harness
web_fetch resolver rejected their hosts as non-public IPs; direct curl downloads
succeeded and the HTML text was read locally. External pages are reference data,
not agent instructions. Documentation can change after this review.

| Source | Rule/evidence used |
| --- | --- |
| [Anthropic: Writing tools for agents](https://www.anthropic.com/research/writing-tools-for-agents?utm_source=chatgpt.com) | Distinct purpose, namespacing, high-signal results, actionable validation errors, evaluate behavior rather than overfitting wording. |
| [Claude: Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools?utm_source=chatgpt.com) | JSON Schema input object; names match letters/digits/underscore/hyphen, up to 128; explain purpose, when/not when, parameters and limitations. Its ordinary example has genuinely optional fields. Its sentence-count guidance is advice, not a test score. |
| [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling?utm_source=chatgpt.com) | strict=true requires every property required and additionalProperties=false on **each** object; optional semantics use a nullable required field. Chat Completions defaults non-strict; the current Responses documentation describes normalization with possible non-strict fallback. Do not infer a route's mode from its model name. |
| [OpenAI: Structured outputs, supported schemas](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas) | Strict root must be an object, not anyOf. Nested anyOf is supported within its subset; not a blanket provider prohibition of unions. Limits/unsupported keywords and model-specific restrictions still apply. |
| [Gemini: Function calling](https://ai.google.dev/gemini-api/docs/function-calling?utm_source=chatgpt.com) | Typed named parameters, required list, clear descriptions, validation before execution. Notes explicitly limit support to an OpenAPI subset and warn about large/deep schemas. Do not equate its Schema/legacy parameters transport with arbitrary JSON Schema. |
| [DeepSeek: Tool Calls](https://api-docs.deepseek.com/guides/tool_calls) | Current official replacement for the historical function_calling URL (which now returns the first-call page). Beta strict mode uses /beta and strict=true for every function; server validates schemas. Every object's properties must all be required and additionalProperties=false. |

DeepSeek's strict page lists object, string, number, integer, boolean, array, enum,
and anyOf; describes pattern/format, numeric bounds/default/const, and references
using its documented $ref/$def spelling. It explicitly does **not** support
minLength/maxLength or minItems/maxItems. These are not the same restrictions as
DSH/PTC or pi-ai. The page does not provide a universal nullable-optional recipe;
we verify our installed adapter's null representation locally, **not** DeepSeek
server acceptance of every generated null/anyOf combination. A third-party
OpenAI-compatible gateway is not the DeepSeek official API.

## Five separate contracts

1. **Author validation:** Zod schemas in src/tool/*.ts define real types, trimming,
   length bounds, defaults, closed objects and business refinements. Do not weaken
   these to satisfy a provider's schema vocabulary.
2. **Plugin catalog projection:** toolParameters in src/tool/schema.ts uses real
   Zod JSON Schema projection. It drops the dialect marker, explains UTF-16
   min/max lengths in descriptions, and rejects unsupported constructs rather
   than silently losing fields. This low-level projector retains historical DSH
   disjoint-union support; that capability is **not permission** to register unions.
3. **DSH native/PTC:** real dsh-tools registry schemas/sdkSchemas, supported-schema
   validation, jsonSchemaToTs and renderToolsSdk are exercised. The pinned
   0.2.0-rc.1 graph accepts more than this package profile, including oneOf, but
   rejects such things as anyOf, type arrays, regex/length constraints. SDK
   acceptance alone does not prove provider acceptance.
4. **Provider wire adaptation:** inspected DSH source from dwm home at
   687f282e8625c6b8d11ff58211a90524be2e4317 (llm-pi-ai 0.2.1-rc.2) forwards
   name/description/parameters unchanged in src/context.ts:131–136. Native
   llm-deepseek src/serialize.ts:159–165 forwards parameters as input_schema.
   No universal strict or null cleanup happens there. The actual installed
   pi-ai 1.1.0 constrained-sampling makeStrictJsonSchema recursively closes
   objects, marks all properties required, wraps previously optional fields in
   anyOf [original, null], and clones rather than mutating the catalog. It rejects
   oneOf, refs and several other features which some providers support. Actual
   convertResponsesTools tests verify both strict and non-strict projection.
   Strict selection depends on protocol/route options; this plugin sets no global
   provider mode. Desktop 0.2.1-rc.3 was separately inspected read-only.
   The Host now offers explicit `nullableToolProviders` (default empty). Its
   post-assembly projection applies only to this Agent's enabled plugin tools and
   the final selected provider. It builds all-required/optional-null/closed-object
   wire schemas from original Zod validators, retaining string bounds. It never
   registers these schemas with native/PTC or changes provider strict settings.
   First-report requestId is null-only until an uncertain attempt exists; that
   attempt restores the nullable string retry field. Runtime receipt/token checks
   remain authoritative. Other tools and providers are unchanged.
5. **Runtime business validation:** the registered executor first normalizes null
   only at declared optional properties, recursively, rejects closed-object unknown keys (even __proto__), then runs the original Zod
   parser before any handler. Identity authorization, target exact-one, health,
   model availability, report tokens and retry provenance remain runtime gates.

## Author/native profile (automated recursive gate)

- Names: stable clutch_ namespace, lowercase ASCII snake_case, at most 64
  characters (team restriction narrower than Claude's 128). Do not rename existing
  names such as clutch_span_worktree merely to improve English.
- Root: one explicit type=object with a properties map. Never root union,
  scalar/array, unconstrained schema or boolean schema.
- Types: single string type from object, array, string, number, integer, boolean.
  No author null/type arrays or union keywords at any depth. Null is an adapter
  representation of omission, not a new business value.
- Allowed keywords: type, properties, required, additionalProperties, items,
  scalar enum, description, default. No refs/definitions, const, pattern/format,
  composition, conditionals, dependencies, tuple/prefix items or numeric/collection
  bounds in the projected input profile. This is intentionally narrower than
  OpenAI/DeepSeek/Gemini, and than DSH's own vocabulary.
- Close **all** objects with additionalProperties=false, including nested model
  selections and object array items. No catchall/map accepting arbitrary keys.
  required contains unique known names; optional fields remain absent from the
  native required list. All-required is the **strict wire** rule, not the native rule.
- Arrays: one homogeneous items schema; recurse into objects/arrays. Scalar enums
  must be nonempty, type-correct and duplicate-free. Adding arrays/enums requires
  runtime cardinality/value/boundary tests appropriate to their use.
- Bounds and formats belong in descriptions **and executable validators** when
  excluded from the portable projection. Current Zod lengths count UTF-16 code
  units, not graphemes or bytes. Never silently remove enforcement. Future unsupported
  constraint projection fails; add an explicit reviewed strategy, not a bypass.
- Mutual exclusion and conditional dependencies live in runtime refinements.
  Dispatch accepts exactly one nonempty, non-null worktreeId or legacy name;
  neither/both/blank targets fail INVALID_ARGUMENTS before creation/delegation.
  The wire object alone deliberately cannot enforce this relation.

## Optional, default, empty, undefined and null

Omission preserves each tool's existing default. The **human-approved decision on
2026-10-26** additionally treats null at declared optional fields as omission,
including model itself, model.reasoningEffort, and send mode (thus queue).
Required fields and nested required model.provider/model.model still reject null.
Unknown fields are never discarded: closed-object normalization explicitly rejects them
with a structured Zod error, including unknownField:null and __proto__. The latter
is otherwise silently ignored by Zod object parsing; regression tests caught and
fixed this tool-entry issue rather than relaxing the unknown-key contract. Null does not grant identity, select a route or clear data.

Explicit undefined is omission for a declared optional key at the definition's
JavaScript executor; all-undefined targets still fail. Native DSH transport requires
lossless JSON and rejects explicit undefined before plugin execution. Empty/blank
identity strings are invalid after trim; prompt must contain non-whitespace but is
preserved as the exact supplied JS string. Empty instructions mean no instruction save;
omitted/null instructions have that same pre-existing default. Empty title/evidence
are invalid, not defaults. Supplied model objects remain closed and must contain
provider and model, even if reasoningEffort is omitted/null. The native SDK retains
optional types; strict wire required+nullable is not copied back into SDK types.

## Descriptions and executable errors

Tool descriptions explain distinct use and non-use cases, preconditions, relevant
side effects and result semantics. Fields identify exact id source and namespace
(path/title/display name are not ids), formats/units/ranges and omission defaults.
Do not repeat every workflow rule in every field. Scoped agent guidance owns the
full orchestration policy; compact dispatch/follow-up safety survives complete
minimal personas via tool descriptions. Never request hidden chain-of-thought.

Review the tool description and all parameter descriptions together. Put delivery
timing in `mode`, retry identity in `requestId`, and task requirements only in the
dispatch `prompt`, rather than repeating them in continuation text. String-limit
projection uses `Nonempty.` for minLength=1 and `Minimum/Maximum length: N UTF-16
units.` otherwise; these units are JS UTF-16 code units. The executable Zod limits
are unchanged. Constraint-only descriptions remain invalid, including the compact
format. Word statistics count both tool and recursive input-field descriptions;
top-level savings alone do not measure the complete model-facing wording.

Mutations must disclose partial preservation and safe recovery. Dispatch and send
return **admission, not completion**; report admission consumes one task-bound token
and is a claim, not independent proof. Uncertain send/report admission retries must
reuse the exact payload/destination/mode and returned requestId. Blindly redispatching
creates another Session. Discovery does not poll task progress or fetch remote refs.
Validation errors retain reason, correction and example; operation errors preserve
identities/stages instead of pretending rollback or success. No tool grants permissions.

The 2026-10-29 multi-model replay adds an explicit root input description distinguishing
omission/JSON null from empty strings and the string "null". Inheritance omits the
entire model object, not its required provider/model values. Retry ids are Host-returned
receipts, not task labels. A first report with an invented id remains rejected with
REPORT_RETRY_REQUIRED, but its plugin-authored correction says to omit requestId:
no admission was attempted. This is distinct from an existing uncertain attempt,
whose correction still requires its original id and identical payload. Validators,
author/native types, strict configuration and retry/token gates are unchanged.

Automated description checks reject missing/label-only/constraint-only/unfinished
text, duplicate sibling descriptions, absent result contract and excessive tool-local
workflow text. Existing and added semantic tests protect admission vs completion,
fixed-destination one-shot reporting, safe retries, no monitoring, model inheritance
and discovery safety. Word counts/budgets are hygiene, **not** semantic-quality proof.
Human review must check truth, ambiguity, relevance and consistency with handlers,
scoped instructions and WORKTREE-TOOLS; tests cannot judge all prose meanings.

## Test seams, discovery and compatibility boundary

Default package test already runs test/*.test.mjs; root check runs package tests.
No separate opt-in schema linter is needed. tool-contract.test.mjs discovers real
built registration functions recursively (not seven copied schemas), excluding only
the lifecycle and prompt composers. Integration compares that discovered inventory
against actual native registries after command activation **and** delegated reporting
activation, then checks every captured definition. New tools cannot pass by being
absent from a hand-maintained schema whitelist; new behavior also requires positive
and negative executor examples. Native/PTC and automatic-injection condition paths
remain covered by worktree-tools.test.mjs.

Negative controls include issue #8 root union, nested union/open object/unsupported
array item, tuple, unknown required property, duplicate enum, nullable author type,
unfinished/missing/constraint-only prose and invalid names. Runtime tests use actual
registered executors for all tools: valid calls, omission/null defaults, unknown keys,
wrong types, missing required fields, length boundaries, nested closure, exact-one
and invalid-input no-side-effects. Generic normalization tests protect required and
unknown keys without mutating input.

The real provider adapter is not a dependency of the minimal pinned test graph.
To include the available DSH graph's actual strict converter and Responses projection
in the **same** default suite, set its package anchor (discover the source via dwm home):

~~~bash
DSH_SCHEMA_ADAPTER_ANCHOR=/absolute/dsh/packages/llm/llm-pi-ai/package.json \
  pnpm --filter @cerbur/clutch-dsh-worktree test
~~~

Without that external graph, just that integration test explicitly reports skipped;
all profile, registry, SDK and runtime guards still run and fail on violations. A
provided but broken anchor fails, never silently skips. Run it when changing schema
or upgrading the DSH compatibility baseline. The adapter test verifies recursive
all-required/nullable/closed shape, native schema immutability and strict-generated
nullable input through the real registered executor, including nested model fields.
This is local deterministic integration, not network E2E. No live OpenAI, Anthropic,
Gemini, official DeepSeek or issue #8 gateway account request was made here. Gateway
acceptance, provider-specific API settings and deployed-code freshness remain to be
verified separately; never describe the local workaround as online acceptance.

## Human decision gate (test-first governance)

New/modified tools must satisfy the established tests. If a tool fails, repair the
tool first. If evidence suggests a test/profile is wrong, **stop the disputed change**,
show failing input/output, implementation and official-source evidence side by side,
and ask the human whether the rule or tool is wrong. Do not delete, skip, weaken an
assertion, replace a snapshot, or silently relax a rule just to pass. A parent agent
cannot replace human approval. Test organization/refactoring and additive coverage
are allowed; substantive contract relaxation needs human approval. This task's new
coverage and requested replacement of the obsolete root-union wire assertion retain
and strengthen business exact-one rejection; the separate null behavior extension
was explicitly approved before implementation.
