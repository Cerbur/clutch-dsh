# Plugin-only Agent steer feedback

The user authorized implementing this directly on `wt-worktree-0.1.19/release`, leaving
changes uncommitted and enabling them in `.dsh-test`. DSH core remains unchanged.

Native QueueDock presents next-turn input, while native Chat pending-steer bubbles only
include human input. Use the public Session-scoped `conversation.input.dock` and native
inbox projection to display this plugin's next-step task relays. Register a private
Conversation target for receipt/cancel evidence; preserve source and message identity.

The strip distinguishes pending, claim preparation, verified append-origin receipt,
cancellation and unknown state. A claim or projection disappearance cannot establish
receipt, and receipt never means task completion. Native queue/report messages are
excluded. Recent terminal records are bounded to eight and clear at the next turn;
pending entries remain, with authoritative native order. Session changes, native history
replacement/pagination, reconnect and plugin disposal use the native registry lifecycle.
No Host changes, transport, polling, Sidecar storage or global refresh are introduced.

Verification: pure state boundaries and real native Conversation assembler replay,
Session isolation, cancellation, reinsertions, missing projection, partial history,
turn resets, plugin disposal and scoped slot wiring. Run all package gates and real UI
checks for both fast consumption and a steer admitted during an executing tool, then
verify receipt retention, sender/content expansion, Session switching and browser refresh.
