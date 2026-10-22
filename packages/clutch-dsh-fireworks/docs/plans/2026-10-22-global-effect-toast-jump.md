# Global fireworks and Session toast navigation

## Scope

Implement on `wt-fireworks-0.1.5/feat-global-effect-toast-jump`. All source and
documentation changes stay inside this plugin; dependency updates regenerate the
workspace lockfile. Do not change DSH, generated host catalogs, or other plugins.
This supersedes the MVP's current-Session-only presentation and its non-goals of
no plugin transport endpoint and no interactive controls.

## Design

- Preserve `happy_fireworks`, its result metadata, and the existing projection.
- Observe live committed `session/event` notifications and reuse the successful
  result/PTC parser. Historical projection hydration is never an event source.
- Publish `clutch_fireworks/launch` notifications. All new event names and the
  shared route endpoint use the `clutch_fireworks` namespace.
- A plugin-owned in-memory feed supplies `/api/clutch_fireworks/events` through
  the public `connection.fetch.register` API. The client uses Connection RPC
  envelopes over the existing authenticated `/api` channel. No DSH edits,
  private WebServer, or generated Typert catalog are needed. Connection owns
  admission: only owner peers can read exact Fetch routes; DSH 0.2.0 has one
  authenticated operator. The supported client target is Web.
- A fresh subscriber receives an empty baseline with a cursor and Host epoch.
  Later polls receive ordered events after that cursor.
- Retain at most 128 events for 30 seconds. Deduplicate Session/tool identities,
  expire stale events, reset the baseline on Host restart, and cancel pending
  requests on disconnect or plugin disposal. This is transient delivery, not
  persisted history or a browser playback acknowledgement.
- Keep one `shell.overlay` subscribed independently of the selected Session.
  Queue animations; show a clickable toast carrying its source Session identity.
  Use DSH's `uiWorkspace.openSession` for navigation. Only the toast intercepts
  pointer input. Each connected owner page consumes independently.
- Refresh starts a new baseline without replay. Brief connection losses can
  catch up within retention; expired events are discarded before playback.
- Raise the DSH minimum to 0.2.0 for Connection RPC, explicitly including the
  current 0.2.1 prerelease family, and align development dependencies.
- Update both README files, release notes, and a feature screenshot.

## Verification

Exercise successful direct/PTC results, errors/cancellations, unrelated events,
background Sessions, same-call deduplication across Sessions, ordered delivery,
baseline/reconnect/restart, expiry, disconnect/disposal, animation queueing, and
toast navigation. Run package typecheck, build/tests, lint/format, workspace
shape and patch checks. Verify actual browser interaction in installed DSH
using `~/.dsh-test` and the Codex built-in browser.
Do not pack, publish, push, or commit without explicit authorization.

## Installed-host regression and acceptance

- Reproduced a successful real `happy_fireworks` invocation with no effect.
  The original `/clutch_fireworks/events` endpoint returned HTTP 405.
- Real Cordis service scopes revealed the failure: dedicated `rpc.handle`
  captures the Connection service's origin context, which cannot access
  `webServer` without injection. Adding injection in the consumer does not
  repair that captured scope. Use the public shared Fetch registration instead.
- A regression test now constructs plugin-owned Cordis Services and exercises
  the real Connection shared dispatcher. The original implementation fails;
  the shared route responds and unregisters on plugin disposal.
- Installed the local package into the test Web profile and ran DSH
  0.2.1-rc.2 on port 3088. A real agent tool call produced
  `clutch_fireworks/launch` with the correct originating Session identity.
- In the built-in browser, submitted the tool call and immediately opened the
  plugins page. Verified 40 animated particles, captured at least 24 visible
  particles together with the toast, and clicked the toast back to the source
  Session while the animation continued. Refresh did not replay the burst.
  `assets/screenshots/global-fireworks-toast.png` is that installed-host capture.
