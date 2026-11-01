# clutch-dsh-office

English | [简体中文](README.zh.md)

Kitchen Chaos brings your active DeepSeek Harness Sessions into a shared 3D
kitchen. Up to four whale girls wander alongside persistent Session bubbles,
while the list below keeps every Session needing attention within reach.

## Installation

### Install from npm

The first npm release is pending. After publication:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-office
dsh web
```

### Install from a local checkout

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-office build

cd /absolute/path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-office
pnpm dsh web
```

Restart DSH Web or Desktop after installation or asset updates, then reload the
client. For Windows checkouts, substitute your local Windows paths. After pulling
updates, rebuild before restarting DSH; refreshing the page alone does not rebuild
assets. No Harness source changes are needed.

## Features

| Feature                       | Preview                                                                                                                                                     | Behavior                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared kitchen                | <img src="assets/screenshots/office-session-board.jpg" width="600" alt="Local preview: four simulated Session characters in Kitchen Chaos">                 | Up to four whale girls represent running, pending-interaction or unread-completed Sessions. The counter and list include overflow; idle Sessions are hidden.                                            |
| Clickable Session bubbles     | Same view above                                                                                                                                             | Persistent title, workspace and status bubbles open the corresponding native Session. Tooltips and the list keep long titles accessible.                                                                |
| Active Session list           | <img src="assets/screenshots/office-session-list.jpg" width="600" alt="Local preview: four active Session states, with no idle rows">                       | Newest updates first, with title and workspace. Running rows show elapsed time, unread completions show completion time, and pending interactions retain their status. The list is not limited to four. |
| Whale girls and local preview | <img src="assets/screenshots/office-character-soft-fill.jpg" width="600" alt="Local preview: four simulated whale girls with soft, bright shading">         | Independent walking and automatic blinking, with soft character lighting. Preview one to four simulated characters without changing real Sessions.                                                      |
| Cozy kitchen                  | <img src="assets/screenshots/office-optimized-kitchen.jpg" width="600" alt="Kitchen with warm window light, a coated range hood and a wooden platform rim"> | A detailed kitchen with gentle warm lighting and soft surfaces.                                                                                                                                         |

The Session and character screenshots use the labeled local preview; their four
entries are simulated.

## Usage

1. Open **Office** in the sidebar to see **DSH Office · Kitchen Chaos**, one kitchen
   and the active Session list.
2. Running, pending-interaction and unread-completed Sessions qualify for a
   character. Priority is pending interaction, running, then unread completion.
   Running subagents roll up to their parent Session.
3. The first four eligible Sessions keep their character slots until they leave.
   Later arrivals wait for a free slot and remain accessible in the list.
4. Click a bubble or list row to open its native Session. Opening Office alone does
   not acknowledge unread completions; DSH manages read state.
5. Double-click the version tag to toggle the labeled one-to-four-character local
   preview. Double-click again to return to live Sessions. Simulated bubbles and
   rows do not navigate.

## Requirements and limits

- Requires DSH Web Client, initially tested with `dsh-v0.2.1-rc.2`, and a browser
  supporting WebGL 2 and WebP images. Rendering failures offer a reload action.
- Only active, nonblank, unarchived parent Sessions from the native list appear.
  Missing workspace relationships are labeled **Ungrouped**.
- Office does not issue model requests, read Session histories or write Session
  logs. Character movement is decorative and does not indicate actual tool activity.
- Disconnection clears stale characters and list rows until reconnection. Displayed
  times are estimates based on native updates and observed transitions, not execution
  logs; missing times are shown explicitly.
- Reduced motion stops wandering and blinking. Hidden scenes pause; offscreen scenes
  release rendering resources and rebuild on return. Animation is capped at 30 FPS; performance depends on
  your device, and close zooms may reveal reduced texture or shadow detail.

## Development

From the repository root:

```bash
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office build
pnpm --filter @cerbur/clutch-dsh-office test
```

## Friendly Links

- [LINUX DO](https://linux.do/) — A new ideal community.
