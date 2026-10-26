# Native Agent relay provenance implementation

Date: 2026-10-26. Follow-up explicitly approved by the human after source investigation.
This extends the all-tool schema task without discarding its uncommitted changes.
Package version and release HEAD are unchanged; no commit/merge/push/publish is authorized.

## Observed defect and approved interface

The old Agent tools reused sessionController.prompt, which always records kind=user
with rpcId. Consequently native context/UI could not distinguish model-authored task
messages and reports from human input. Text labels alone did not repair that identity.

Keep ordinary Worktree Sessions, all Workspace/binding/cwd/permission gates and existing
model/preset behavior. Native subagents.sendMessage is not a generic Session transport:
it requires durable direct-parent lineage and continuable residency, steers by default,
and does not expose this plugin's queue/requestId contract. Do not forge that lineage.

## Implemented native seam

- A shared sendAgentMessage Host port uses public DSH createUserMessage/freezeMessage,
  exact live calling Agent identity, native source kind=agent-message, form=relay and
  senderSessionId. A native-style Agent prefix carries provenance into provider text;
  the supplied body stays exact. Provider role remains user, never impersonated
  assistant/system/developer. Current native Agent Teams uses the same source form.
- The final enqueue uses recipient.followup for queue and recipient.steer for steer.
  Native inbox/driver/Session own acceptance, wakeup and new-message persistence.
  No direct raw event append, metadata patch, message/history rewrite or second
  persistent receipt directory is introduced. Human prompts/Dashboard tasks keep
  sessionController.prompt and are not relabeled as Agent messages.
- requestId hashes into a deterministic namespaced native message id. Per-target
  admission is serialized; native pending messages, inbox insertions and consumed user/message events
  supply retry receipts. The source/body must match the receipt; upper dispatch
  signatures additionally lock sender, destination, body and mode. No successful
  receipt cache retains message content. A receipt read failure rejects, not sends.
- Caller cancellation, plugin disposal, Agent disposal/replacement and exact live
  sender/target identity are checked before final synchronous native acceptance.
  An observer failure after acceptance keeps the same id for a deduplicated retry.
- Task activation now requires a consumed relay id matching a recorded dispatch
  and its actual sender. Human RPCs cannot activate new relay tokens. Old plugin
  RPC prefixes stay callback-blocked without rewriting old history. Ordinary
  unrelated Agent relays close the previous task. Report claims retain at most
  512 id-only sender/recipient receipts, with no bodies, Agent objects or tokens.
  A matching claimed-report receipt blocks automatic callbacks but preserves an
  otherwise valid outer task. A report-looking id alone cannot preserve authority.
  The receipt never grants authorization or asserts success; only the existing
  one-shot report token authorizes reporting. Recipient/plugin disposal clears
  these routing facts; sender disposal does not erase an already queued report.
- Native Chat classification and relay renderer are reused without Client or DSH
  core edits. Supported UI shows the sending Session or an Agent turn-trigger;
  old source=user history stays human rather than being guessed from text.

## Regression-first evidence

1. Initial Session-port provenance test failed because sendAgentMessage was absent;
   added the native message/inbox Adapter and verified human route unchanged.
2. Concurrent and uncertain retries failed 2 != 1 before native receipt checks;
   added serialized native receipt lookup, including consumed-message replay after
   adapter recreation, source/body mismatch rejection and fail-closed history I/O.
3. Relay task-activation test initially failed REPORT_TASK_NOT_STARTED; changed
   consumption correlation to native message id plus actual sender. Existing token,
   callback, ancestry, concurrency, memory-bound and partial-failure assertions stay.
4. Existing fixture transports now emit the real relay record while retaining their
   admission failure injection. Added actual-caller/source-forgery/mode-retry tests.
5. Native integration executes real upstream ReactLoopInbox/fold, provider toPiContext,
   Chat messageDefinition/contextForm/turnTriggerDetails and relay ContextBody via
   React SSR. It verifies human vs relay, model-visible identity, serialized history
   replay and no duplicate receipt after adapter recreation. Native algorithms are
   not copied; storage/driver shell, CSS and unexercised image/unknown-block paths
   are isolated. This is not a running-GUI screenshot or provider account E2E.

## Dependencies and verification boundary

Direct native message factory use adds an explicit dsh-llm peer and same-baseline
0.2.0-rc.1 dev dependency. Importing Session service types briefly exposed unrelated
Client Context declaration merges; switched to llm data types/structural ports, not
Client changes. pnpm initially re-solved unrelated peer graphs; those generated
changes were discarded, preserving original snapshots. The final lock diff adds
only three lines for the Worktree importer, verified by frozen install. No existing
package version is upgraded. A native source-map type key declares the unchanged
native relay wire record without importing subagent service Context declarations.

Use DSH_NATIVE_SOURCE for the available upstream source graph and
DSH_SCHEMA_ADAPTER_ANCHOR for its installed pi-ai dependency in the existing default
suite. With no external graph only those explicit external seams skip; a supplied
broken graph fails. All local transport/schema/runtime guards always run.

No running DSH profile, real Session history or GUI deployment has been changed.
Full native-driver/browser E2E and live provider acceptance remain separate checks.

## Claimed retry P1 repair (2026-10-29)

The original pending/consumed lookup missed the real Loop's claim → awaited
system-prompt assembly/request preparation → user/message interval. The supplied
`/private/tmp/review-relay-claimed-retry.mjs` reproduced two native executions with
the same message id. A regression was added to native-worktree-tool-lifecycle
before implementation and failed with `2 !== 1` at its exactly-once assertion.

Use the existing durable `agent/inbox/spliced.inserted` fact as an admission receipt
through pending, claimed and consumed states. Scan every matching occurrence in
pending input, insertion history and user/message history, validating source and
exact content. A native queue edit keeps its id; neither its original nor edited
payload may reuse that id when the receipts conflict. The replacement-body test
first failed with Missing expected rejection. Unknown insertion formats must also
fail closed; its regression first failed with Missing expected rejection.
No second receipt store or cache, interface/schema change or token change is added.
Upper dispatch signatures still own mode equality, and existing final cancellation,
live-Agent identity and disposable observation gates remain intact.

Focused verification covers both queue/steer and both async native boundaries,
concurrent retries through recreated Adapters, altered body rejection, actual
native inbox remove/clear/steer/edit-then-claim operations, and JSON replay through
the real native inbox fold. This replay is not a full persistence-backend resume
or live provider test. Native resume was inspected: it restores the persisted log
(with interrupted-turn closers), retaining the insertion facts used here.
No running profile/history or upstream source is modified. Public promised retry
semantics are restored; bilingual README guidance needs no change.

The focused three-file suite passed **32 tests, 0 failed, 0 skipped**, with
`DSH_NATIVE_SOURCE=/Users/yuancheng/Documents/Code/deepseek-harness`. Logs:
`/private/tmp/relay-p1-{focused,build,lint,typecheck}.log`. Package build, lint and
typecheck passed; the original standalone reproducer now consumes exactly once.
Build required scoped execution approval for this checkout outside the default
writable roots after an initial EPERM failure. Parent regression and
independent review own the mandatory full gates after this focused repair.

## Final verification

Final source includes an additional regression-first hardening found during review:
a resolver returning another live Session must not redirect an authorized relay.
The new test first failed with a missing rejection; the Adapter now checks that
resolved recipient id equals the authorized target after every await. A separate
negative test also proved that a report-looking id alone is insufficient; only
Host-correlated report receipts preserve outer-task authority.

All first six commands ran from this feature Worktree's monorepo root with pnpm
10.32.1. The final test invocation set both DSH_NATIVE_SOURCE and
DSH_SCHEMA_ADAPTER_ANCHOR to the existing source graph, so neither external seam
was skipped. No install or edit was performed in that DSH checkout.

| Command | Result |
| --- | --- |
| pnpm run check:workspace | exit 0 |
| pnpm run check:patches | exit 0; existing YAML !!js unresolved-tag warning |
| pnpm --filter @cerbur/clutch-dsh-worktree lint | exit 0 |
| pnpm --filter @cerbur/clutch-dsh-worktree typecheck | exit 0 |
| pnpm --filter @cerbur/clutch-dsh-worktree build | exit 0 |
| pnpm --filter @cerbur/clutch-dsh-worktree test | **1271 passed, 0 failed, 0 skipped**, exit 0 |
| node --test test/readme-parity.test.mjs (package directory) | **1 passed**, exit 0 |
| git diff --check | exit 0 |

Raw final logs are /tmp/worktree-tool-research/relay-final-{workspace,patches,lint,typecheck,build,test}.log.
The full summary is relay-final-test.log:1304–1311. Real native inbox/context/UI
integration passed at line 915; genuine strict adaptation passed at line 1207.
The earlier all-tool schema gate and its negative controls remain in the suite.

Changes remain uncommitted in the same feature Worktree, with prior schema work
preserved. Root lockfile changes only the Worktree importer (+3 lines); no other
plugin, DSH core, original Session data, package version or running GUI/profile
was changed. There is no outstanding human contract decision. Loading the new
Host code and refreshing the existing GUI are still required before observing
new relays in a live conversation; that deployment and live-provider E2E were
not performed or claimed here.
