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

// Border width: 2 chars each side for heavy claustrophobic weight
const BORDER_W = 2;

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

		// ─── BOTTOM BAR: functional data ───
		const model = this.ctx.model ? this.ctx.model.id : "—";
		const ctxUsage = this.ctx.getContextUsage();
		const contextWindow = ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const tokens = ctxUsage?.tokens != null ? `${Math.round(ctxUsage.tokens / 1000)}k` : "?";
		const ctxSize = contextWindow >= 1_000_000
			? `${(contextWindow / 1_000_000).toFixed(1)}M`
			: contextWindow >= 1_000
				? `${(contextWindow / 1_000).toFixed(0)}k`
				: `${contextWindow}`;

		const leftData = ` >> ${this.stateLabel} << `;
		const rightData = ` ${tokens}/${ctxSize} ${model} `;
		const leftWidth = visibleWidth(leftData);
		const rightWidth = visibleWidth(rightData);
		const gap = Math.max(0, width - leftWidth - rightWidth);

		lines[lines.length - 1] = `${border(leftData + " ".repeat(gap) + rightData)}`;

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

	// Helper: four-state border — steel (idle), indigo (thinking), chartreuse (responding), hot pink (tool exec)
	const borderFn = () => isTooling ? cageTooling : isThinking ? cageThinking : isWorking ? cageResponding : cageIdle;

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

		// ── Project/session label for the cage top ──
		const projectName = path.basename(ctx.cwd) || "PI";
		const branchLabel = () => branch ? `${branch}${branchDirty ? "*" : ""}` : "";
		const cageLabel = () => {
			const b = branchLabel();
			return b ? `${projectName} ${b}` : projectName;
		};

		// ── Widget: TOP EDGE of the cage (pinned above editor) ──
		ctx.ui.setWidget("brutal-frame-top", (_tui, _theme) => ({
			render(width: number): string[] {
				const border = borderFn();
				const label = ` ${cageLabel()} `;
				const labelWidth = visibleWidth(label);
				const fill = Math.max(0, width - labelWidth);
				return [border(label + " ".repeat(fill))];
			},
			invalidate() {},
		}));

		// ── Editor: side borders + top/bottom bars ──
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentEditor = new BrutalEditor(tui, theme, keybindings, ctx);
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
		currentEditor = undefined;
	});
}
