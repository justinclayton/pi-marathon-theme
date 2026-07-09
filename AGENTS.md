# AGENTS.md

Orientation for AI agents working in this repo. Read this first — it should
save you from having to reverse-engineer the whole codebase.

## What this is

`pi-marathon-theme` is a **pi package** (a distributable bundle for the `pi`
coding agent) that ships a neobrutalist "Marathon" UI: a set of color **themes**
plus one **extension** that draws a heavy industrial "cage" around the input
editor and animates a live agent-status readout.

It is published to npm as `pi-marathon-theme` and consumed by pi via the `pi`
field in `package.json`.

## Layout

```
package.json                     # pi package manifest (see "pi" field)
Makefile                         # versioning + npm publish only (no build/test)
README.md                        # user-facing install/usage docs
themes/
  marathon.json                  # the primary theme ("marathon")
  marathon-brutal.json           # variants (frost / green / brutal)
  marathon-frost.json
  marathon-green.json
  marathon_brutal.yaml           # matching Warp terminal theme
extensions/
  marathon-theme/
    index.ts                     # THE extension — ~400 lines, all logic here
```

`package.json` → `pi.extensions` points at `./extensions/marathon-theme`,
`pi.themes` points at `./themes`. There is **one** source file of substance:
`extensions/marathon-theme/index.ts`.

## The extension: `extensions/marathon-theme/index.ts`

A pi extension is a default-exported function `(pi: ExtensionAPI) => void` that
registers event handlers. This one builds a "cage" around the editor out of
three pinned UI regions and drives a status animation.

### The cage (three regions, one shared border style)

- **Top edge** — `ctx.ui.setWidget("brutal-frame-top", …)`: renders the
  **centered animated status** (`>> READY <<` etc.).
- **Side borders + top/bottom bars** — `ctx.ui.setEditorComponent(…)` returns a
  `BrutalEditor extends CustomEditor`. Its `render()` wraps pi's editor lines
  with thick (`BORDER_W = 2`) side borders, a solid top bar, and a functional
  **bottom bar**.
- **Bottom edge** — `ctx.ui.setFooter(…)`: a solid fill line.

All three tint themselves via the same `borderFn()` so the whole cage changes
color together based on agent state.

### State → color (the "four-state border")

A module-level `borderFn()` (and the mirror logic inside `BrutalEditor.render`)
picks one of four background style functions:

| State       | Flag         | Color slot (from theme) | Look           |
|-------------|--------------|-------------------------|----------------|
| idle        | (none)       | `STEEL_BG` (hardcoded)  | steel grey     |
| responding  | `isWorking`  | `accent`                | chartreuse     |
| thinking    | `isThinking` | `thinkingHigh`          | indigo         |
| tool exec   | `isTooling`  | `error`                 | hot pink       |

Colors are read **from the active pi theme at `session_start`** via
`theme.getFgAnsi(slot)` → `parseRgbFromFgAnsi()` → `buildBgFn()`, then used as
**backgrounds**. Aesthetic creed (top-of-file comment): *hard on/off working
state, no gradients, no smooth animations.*

### State is tracked twice, kept in sync

Because the top widget and the editor render in different scopes, agent state
lives in **two places that must stay in lockstep**:

1. **Module-level** `let isWorking / isThinking / isTooling / stateLabel` — used
   by the top widget and `borderFn()`.
2. **`BrutalEditor` instance fields** — set through `setWorking()`,
   `setThinking()`, `setTooling()`, `setStateLabel()`, `setBranch()`, etc.

Every event handler updates **both**. If you add state, wire up both sides or
the top and bottom will disagree.

### The chevron animation (the part we iterate on most)

The status label is bracketed by chevrons that **grow inward** while the agent
is active, then reset — a pulse. Tuning constants at the top of the file:

- `FIELD_W = 5` — width of each chevron field; also the max chevron count.
- `STEP_MS = 120` — ms per growth step **and** the repaint cadence.
- `leftMarquee(phase)` / `rightMarquee(phase)` — build one field. Count goes
  `1 → FIELD_W` (`>`, `>>`, `>>>`, …) then wraps. Right side mirrors with `<`.
- `IDLE_LEFT` / `IDLE_RIGHT` — static frame shown when idle (`>>` / `<<`).
- `phase = Math.floor(Date.now() / STEP_MS)` — motion derives from wall-clock
  time, so it's smooth no matter which event triggered the repaint.

**Animation clock:** a `setInterval` (`startAnim`/`stopAnim`) calls
`currentEditor.tick()` → `this.tui.requestRender()` every `STEP_MS`. It runs
only while the agent is active (started on `agent_start`, stopped on
`agent_end` / `session_shutdown`). This matters because the token stream goes
**silent during long tool runs** — the interval keeps the pulse moving anyway.

### The bottom bar layout (fixed-width, symmetry-anchored)

The bottom bar shows `project branch*` (left) and `tokens/model` (right),
separated by **two fixed vertical dividers** at `center ± SECTION_GAP`
(`SECTION_GAP = 20`, `center = Math.floor(width / 2)`).

Two invariants that were hard-won — don't regress them:

- **Everything is fixed-width.** `fitLeft()` / `fitRight()` pad-or-truncate each
  side into an exact cell so the dividers never jitter as text length changes.
- **The top status centers on the same `Math.floor(width/2)` column as the
  bottom divider**, so the cage has one true vertical symmetry axis. The top's
  `leftPad = center − Math.floor(statusWidth/2)` (NOT an independent
  `floor((width−statusWidth)/2)`) — that independent form is off-by-one on
  differing width parity. Keep them tied to the same `center`.

### Event handlers (what sets what)

- `session_start` — build cage styles from theme, register the three regions,
  kick off git branch/dirty refresh, suppress pi's default working indicator.
- `agent_start` / `agent_end` — toggle `isWorking`, start/stop the anim clock.
- `turn_start` — `stateLabel = TURN:n`.
- `message_update` — maps stream event type → `THINKING` / `RESPONDING` label
  and toggles `isThinking`.
- `tool_execution_start` / `_end` — toggle `isTooling`, refresh git dirty state.
- `session_shutdown` — stop clock, drop editor reference.

## How pi loads this

pi loads extensions and themes at **session start**. When developing against a
local checkout of this repo, edits to `index.ts` are only picked up on a fresh
session — you must **restart pi** to see changes.

## Working here

- **No build / test / typecheck toolchain** is set up in this repo (no `tsc`,
  no deps installed). The `Makefile` only does version bumps + `npm publish`.
  Verify the pi / pi-tui API surface against the installed pi type definitions
  (shipped with the `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
  packages) when unsure.
- **To preview a change:** restart pi, send a prompt, watch the cage. There is
  no headless renderer.
- **Release:** `make release-patch|minor|major` (checks clean tree + main +
  in-sync, bumps version, `npm publish`, pushes tags).
- Keep edits inside `index.ts`; respect the fixed-width and single-symmetry-axis
  invariants above, and update **both** state locations when adding state.
