/**
 * Marathon Brutal Extension
 *
 * Neobrutalist UI: the input zone is enclosed in a heavy cage.
 * Widget = top edge, footer = bottom edge, editor = side borders.
 * Hard on/off working state. No gradients, no smooth animations.
 *
 * Colors are derived from the active pi theme at session start:
 *   accent      → responding (chartreuse bg)
 *   error       → tool execution (hot pink bg)
 *   thinkingHigh→ thinking (indigo bg)
 *   borderMuted → idle (steel bg)
 *
 * Pair with "marathon-brutal" pi theme + marathon_brutal.yaml Warp theme.
 */

import path from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

// ─── ANSI helpers ─────────────────────────────────────────────────────
const RESET = "\x1b[0m";

/**
 * Parse RGB values from a getFgAnsi() result.
 * Expects format like "\x1b[38;2;R;G;Bm" (truecolor) or "\x1b[38;5;Nm" (256-color)
 */
function parseRgbFromFgAnsi(ansi: string): { r: number; g: number; b: number } | null {
	// Truecolor: \x1b[38;2;R;G;Bm
	const tcMatch = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
	if (tcMatch) {
		return { r: Number(tcMatch[1]), g: Number(tcMatch[2]), b: Number(tcMatch[3]) };
	}
	return null;
}

/**
 * Build a background styling function from a theme color.
 * Uses the theme's fg color as a background, with the specified text color on top.
 */
function buildBgFn(
	theme: Theme,
	bgColorSlot: "accent" | "error" | "thinkingHigh" | "borderMuted",
	lightText: boolean,
): (text: string) => string {
	const bgAnsi = theme.getFgAnsi(bgColorSlot);
	const bgRgb = parseRgbFromFgAnsi(bgAnsi);

	if (bgRgb) {
		// Determine text color: dark (for bright bgs) or light (for dark bgs)
		const fgR = lightText ? 232 : 18;
		const fgG = lightText ? 232 : 18;
		const fgB = lightText ? 224 : 16;
		return (text: string) =>
			`\x1b[38;2;${fgR};${fgG};${fgB}m\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m${text}${RESET}`;
	}

	// Fallback: just use inverse of the fg color
	return (text: string) => `${bgAnsi}\x1b[7m${text}${RESET}`;
}

// Structural cage color: steel (the concrete material, not a semantic theme color)
const STEEL_BG = (text: string) =>
	`\x1b[38;2;232;232;224m\x1b[48;2;58;58;54m${text}${RESET}`;

// too-dumb severity blocks: solid backgrounds that pop against the cage.
// Hard on/off, no gradients — orange = "compact soon", red = full dumb zone.
const DUMB_ORANGE_BG = (text: string) =>
	`\x1b[38;2;18;18;16m\x1b[48;2;240;150;0m${text}${RESET}`;
const DUMB_RED_BG = (text: string) =>
	`\x1b[38;2;240;240;230m\x1b[48;2;200;30;40m${text}${RESET}`;

// Border width: 2 chars each side for heavy claustrophobic weight
const BORDER_W = 2;

// ─── Chevron marquee (non-idle) ──────────────────────────────────────
// While the agent is active, a line of chevrons grows inward from a fixed
// outer anchor toward the state label — starting at a single '>', becoming
// '>>', '>>>' … filling toward the label — then snaps back to '>' and repeats.
// The growth-and-reset reads as a pulse. Fixed width keeps the readout stable.
const FIELD_W = 5;   // width of each chevron field (chars)
const STEP_MS = 120; // ms per growth step (also the repaint cadence)

// Left field: chevrons grow rightward from the outer anchor toward the label.
function leftMarquee(phase: number): string {
	const count = 1 + (((phase % FIELD_W) + FIELD_W) % FIELD_W); // 1 → FIELD_W
	return ">".repeat(count) + " ".repeat(FIELD_W - count);
}

// Right field: mirror — chevrons grow leftward from the outer anchor toward label.
function rightMarquee(phase: number): string {
	const count = 1 + (((phase % FIELD_W) + FIELD_W) % FIELD_W);
	return " ".repeat(FIELD_W - count) + "<".repeat(count);
}

// Static idle fields — the starting frame: '>>' / '<<' at the outer anchor.
const IDLE_LEFT = ">>" + " ".repeat(FIELD_W - 2);
const IDLE_RIGHT = " ".repeat(FIELD_W - 2) + "<<";

// Fit plain text into a fixed-width cell: pad or hard-truncate.
function fitLeft(s: string, w: number): string {
	const sw = visibleWidth(s);
	if (sw > w) return s.slice(0, Math.max(0, w));
	return s + " ".repeat(w - sw);
}
function fitRight(s: string, w: number): string {
	const sw = visibleWidth(s);
	if (sw > w) return s.slice(s.length - Math.max(0, w));
	return " ".repeat(w - sw) + s;
}
// Center plain text in a fixed-width cell: pad both sides or hard-truncate.
function fitCenter(s: string, w: number): string {
	const sw = visibleWidth(s);
	if (sw >= w) return s.slice(0, Math.max(0, w));
	const left = Math.floor((w - sw) / 2);
	return " ".repeat(left) + s + " ".repeat(w - sw - left);
}

// ─── Cage style functions (populated from theme at session start) ─────
type StyleFn = (text: string) => string;

let cageIdle: StyleFn = STEEL_BG;
let cageResponding: StyleFn = (t) => t;
let cageThinking: StyleFn = (t) => t;
let cageTooling: StyleFn = (t) => t;

// ─── Editor: Brutalist bordered box (provides left/right frame edges) ─
class BrutalEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private isWorking = false;
	private isTooling = false;
	private isThinking = false;
	private branch: string | undefined;
	private branchDirty = false;
	private turnCount = 0;
	private stateLabel = "READY";
	// Bottom-center readout fed by the too-dumb extension's "too-dumb:change" signal.
	private dumbMessage = "";
	private dumbSeverity: "orange" | "red" | null = null;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
	) {
		super(tui, theme, keybindings, { paddingX: 1 });
		this.ctx = ctx;
	}

	setWorking(w: boolean) { this.isWorking = w; }
	setTooling(t: boolean) { this.isTooling = t; }
	setThinking(t: boolean) { this.isThinking = t; }
	setBranch(b: string | undefined) { this.branch = b; }
	setBranchDirty(d: boolean) { this.branchDirty = d; }
	setTurnCount(c: number) { this.turnCount = c; }
	setStateLabel(label: string) { this.stateLabel = label; }
	setDumb(message: string, severity: "orange" | "red" | null) {
		this.dumbMessage = message;
		this.dumbSeverity = severity;
	}

	// Force a repaint from the animation clock (protected tui via Editor base).
	tick() { this.tui.requestRender(); }

	render(width: number): string[] {
		const innerWidth = width - (BORDER_W * 2);
		const lines = super.render(innerWidth);
		if (lines.length < 2) return lines;

		const border = this.isTooling ? cageTooling : this.isThinking ? cageThinking : this.isWorking ? cageResponding : cageIdle;

		// Add thick side borders to content lines
		const borderFill = " ".repeat(BORDER_W);
		for (let i = 1; i < lines.length - 1; i++) {
			const lineWidth = visibleWidth(lines[i]);
			const rightPad = Math.max(0, innerWidth - lineWidth);
			lines[i] = `${border(borderFill)}${lines[i]}${" ".repeat(rightPad)}${border(borderFill)}`;
		}

		// ─── TOP BAR: solid fill (part of cage frame) ───
		lines[0] = `${border(" ".repeat(width))}`;

		// ─── BOTTOM BAR: project + branch (left) · usage (right) ───
		const model = this.ctx.model ? this.ctx.model.id : "—";
		const ctxUsage = this.ctx.getContextUsage();
		const contextWindow = ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const tokens = ctxUsage?.tokens != null ? `${Math.round(ctxUsage.tokens / 1000)}k` : "?";
		const ctxSize = contextWindow >= 1_000_000
			? `${(contextWindow / 1_000_000).toFixed(1)}M`
			: contextWindow >= 1_000
				? `${(contextWindow / 1_000).toFixed(0)}k`
				: `${contextWindow}`;

		// Left: project name + git branch (dirty marker).
		const projectName = path.basename(this.ctx.cwd) || "PI";
		const branchLabel = this.branch ? `${this.branch}${this.branchDirty ? "*" : ""}` : "";
		const cageLabel = branchLabel ? `${projectName} ${branchLabel}` : projectName;
		const leftData = ` ${cageLabel} `;
		const rightData = ` ${tokens}/${ctxSize} ${model} `;

		// Two fixed dividers on the bottom bar, 30 columns either side of center,
		// marking the inner edge of each corner (data) section. Content hugs the
		// outer corners; the span between the dividers stays open.
		const center = Math.floor(width / 2);
		const SECTION_GAP = 25; // distance from center to each inner edge
		const innerL = center - SECTION_GAP;
		const innerR = center + SECTION_GAP;
		const leftCell = fitLeft(leftData, innerL);                 // left corner section
		const midWidth = Math.max(0, innerR - innerL - 1);          // innerL → innerR
		// Center section: too-dumb signal readout. When a warning is active it gets
		// its own solid severity background so it pops out of the cage; otherwise it
		// blends with the border fill.
		const midGap = fitCenter(this.dumbMessage, midWidth);
		const midStyle = this.dumbSeverity === "red"
			? DUMB_RED_BG
			: this.dumbSeverity === "orange"
				? DUMB_ORANGE_BG
				: border;
		const rightCell = fitRight(rightData, width - innerR - 1);  // right corner section

		lines[lines.length - 1] = `${border(leftCell + "┃")}${midStyle(midGap)}${border("┃" + rightCell)}`;

		return lines;
	}
}

// ─── Main extension ──────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	let isWorking = false;
	let isTooling = false;
	let isThinking = false;
	let currentEditor: BrutalEditor | undefined;
	let turnCount = 0;
	let stateLabel = "READY";
	// Bottom-center dumbness readout, driven by the too-dumb extension's signal.
	let dumbMessage = "";
	let dumbSeverity: "orange" | "red" | null = null;

	// ─── Marquee animation clock ────────────────────────────────────
	// A steady tick drives the conveyor even when the token stream is quiet
	// (e.g. during long tool executions). Runs only while the agent is active.
	let animTimer: ReturnType<typeof setInterval> | undefined;
	const startAnim = () => {
		if (animTimer) return;
		animTimer = setInterval(() => currentEditor?.tick(), STEP_MS);
	};
	const stopAnim = () => {
		if (animTimer) { clearInterval(animTimer); animTimer = undefined; }
		currentEditor?.tick(); // settle to the static idle chevrons
	};

	// Helper: four-state border — steel (idle), indigo (thinking), chartreuse (responding), hot pink (tool exec)
	const borderFn = () => isTooling ? cageTooling : isThinking ? cageThinking : isWorking ? cageResponding : cageIdle;

	// ─── too-dumb signal ─────────────────────────────────────────────
	// Subscribe to the "too-dumb:change" event broadcast by pi-extension-too-dumb
	// on the shared event bus. Render its warning in the bottom-center section.
	// Edge-triggered: fires only when the warning changes (including back to null).
	pi.events.on("too-dumb:change", (data) => {
		const payload = data as {
			warning: { severity: "orange" | "red"; message: string } | null;
		} | undefined;
		const warning = payload?.warning ?? null;
		if (warning) {
			dumbSeverity = warning.severity;
			dumbMessage = warning.severity === "red" ? "DUMB ZONE ACTIVATED" : "COMPACT SOON";
		} else {
			dumbSeverity = null;
			dumbMessage = "";
		}
		if (currentEditor) {
			currentEditor.setDumb(dumbMessage, dumbSeverity);
			currentEditor.tick(); // repaint immediately; the signal is edge-triggered
		}
	});

	// ─── Session start ───────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		// ── Build cage styles from active theme ──
		const theme = ctx.ui.theme;
		cageResponding = buildBgFn(theme, "accent", false);       // chartreuse bg, dark text
		cageTooling = buildBgFn(theme, "error", false);           // hot pink bg, dark text
		cageThinking = buildBgFn(theme, "thinkingHigh", true);    // indigo bg, light text
		cageIdle = STEEL_BG;                                      // structural steel, always

		turnCount = 0;
		stateLabel = "READY";

		// Git state
		let branch: string | undefined;
		let branchDirty = false;
		const refreshBranch = async () => {
			const result = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }).catch(() => undefined);
			branch = result?.stdout.trim() || undefined;
			if (currentEditor) currentEditor.setBranch(branch);
		};
		const refreshDirty = async () => {
			const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
			branchDirty = !!(result?.stdout && result.stdout.trim().length > 0);
			if (currentEditor) currentEditor.setBranchDirty(branchDirty);
		};
		void refreshBranch();
		void refreshDirty();

		// ── Project name (used for the terminal title) ──
		const projectName = path.basename(ctx.cwd) || "PI";

		// ── Widget: TOP EDGE of the cage — animated status, centered ──
		ctx.ui.setWidget("brutal-frame-top", (_tui, _theme) => ({
			render(width: number): string[] {
				const border = borderFn();
				const animating = isWorking || isThinking || isTooling;
				const phase = Math.floor(Date.now() / STEP_MS);
				const lf = animating ? leftMarquee(phase) : IDLE_LEFT;
				const rf = animating ? rightMarquee(phase) : IDLE_RIGHT;
				const status = `${lf} ${stateLabel} ${rf}`;
				const statusWidth = visibleWidth(status);
				// Center on the SAME column as the bottom divider (Math.floor(width/2))
				// so the cage keeps one true symmetry axis regardless of width parity.
				const center = Math.floor(width / 2);
				const leftPad = Math.max(0, center - Math.floor(statusWidth / 2));
				const rightPad = Math.max(0, width - statusWidth - leftPad);
				return [border(" ".repeat(leftPad) + status + " ".repeat(rightPad))];
			},
			invalidate() {},
		}));

		// ── Editor: side borders + top/bottom bars ──
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentEditor = new BrutalEditor(tui, theme, keybindings, ctx);
			currentEditor.setDumb(dumbMessage, dumbSeverity); // restore any active warning
			return currentEditor;
		});

		// ── Footer: BOTTOM EDGE of the cage (pinned below editor) ──
		ctx.ui.setFooter((_tui, _theme) => ({
			render(width: number): string[] {
				const border = borderFn();
				return [border(" ".repeat(width))];
			},
			invalidate() {},
		}));

		// ── Title ──
		ctx.ui.setTitle(`${projectName} — READY`);

		// Suppress default working indicator entirely
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setWorkingIndicator({ frames: [] });
		ctx.ui.setWorkingMessage("");
	});

	// ─── Agent start ─────────────────────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		isWorking = true;
		turnCount = 0;
		stateLabel = "AGENT_START";
		startAnim();
		if (currentEditor) {
			currentEditor.setWorking(true);
			currentEditor.setTurnCount(0);
			currentEditor.setStateLabel("AGENT_START");
		}
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setWorkingIndicator({ frames: [] });
		ctx.ui.setWorkingMessage("");
		ctx.ui.setTitle(`${path.basename(ctx.cwd)} — AGENT_START`);
	});

	// ─── Agent end ───────────────────────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		isWorking = false;
		isTooling = false;
		isThinking = false;
		stateLabel = "READY";
		stopAnim();
		if (currentEditor) {
			currentEditor.setWorking(false);
			currentEditor.setTooling(false);
			currentEditor.setThinking(false);
			currentEditor.setStateLabel("READY");
		}
		ctx.ui.setTitle(`${path.basename(ctx.cwd)} — READY`);
	});

	// ─── Turn tracking ───────────────────────────────────────────────
	pi.on("turn_start", async (_event, ctx) => {
		turnCount++;
		stateLabel = `TURN:${turnCount}`;
		if (currentEditor) {
			currentEditor.setTurnCount(turnCount);
			currentEditor.setStateLabel(stateLabel);
		}
		ctx.ui.setTitle(`${path.basename(ctx.cwd)} — ${stateLabel}`);
	});

	// ─── Message streaming ───────────────────────────────────────────
	pi.on("message_update", async (event, ctx) => {
		const rawType = event.assistantMessageEvent?.type || "message_update";
		// Map stream events to readable labels
		let label: string;
		let thinking = false;
		if (rawType.startsWith("thinking")) {
			label = "THINKING";
			thinking = true;
		} else if (rawType.startsWith("text")) {
			label = "RESPONDING";
		} else {
			label = rawType.toUpperCase();
		}
		isThinking = thinking;
		stateLabel = label;
		if (currentEditor) {
			currentEditor.setThinking(thinking);
			currentEditor.setStateLabel(label);
		}
		ctx.ui.setTitle(`${path.basename(ctx.cwd)} — ${label}`);
	});

	// ─── Tool tracking ───────────────────────────────────────────────
	pi.on("tool_execution_start", async (event, ctx) => {
		isTooling = true;
		isThinking = false;
		stateLabel = `TOOL_EXECUTION_START:${event.toolName.toUpperCase()}`;
		if (currentEditor) {
			currentEditor.setTooling(true);
			currentEditor.setThinking(false);
			currentEditor.setStateLabel(stateLabel);
		}
		ctx.ui.setTitle(`${path.basename(ctx.cwd)} — ${stateLabel}`);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		isTooling = false;
		if (currentEditor) currentEditor.setTooling(false);
		// Refresh dirty state
		const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
		const dirty = !!(result?.stdout && result.stdout.trim().length > 0);
		if (currentEditor) currentEditor.setBranchDirty(dirty);
	});

	// ─── Cleanup ─────────────────────────────────────────────────────
	pi.on("session_shutdown", async () => {
		stopAnim();
		currentEditor = undefined;
	});
}
