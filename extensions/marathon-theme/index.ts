/**
 * Marathon Brutal Extension
 *
 * Neobrutalist UI: heavy slab header, hard on/off working state,
 * chartreuse structural borders, functional labels. No gradients,
 * no smooth animations, no metaphor.
 *
 * Pair with "marathon-brutal" pi theme + marathon_brutal.yaml Warp theme.
 */

import path from "node:path";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

// ─── ANSI helpers ─────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const rgb = (r: number, g: number, b: number, text: string) =>
	`\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
const bgRgb = (r: number, g: number, b: number, text: string) =>
	`\x1b[48;2;${r};${g};${b}m${text}`;
const fgRgb = (r: number, g: number, b: number) =>
	`\x1b[38;2;${r};${g};${b}m`;

// ─── Palette: fixed, minimal, no interpolation ───────────────────────
const CHARTREUSE = { r: 195, g: 252, b: 13 };
const BONE = { r: 232, g: 232, b: 224 };
const VOID = { r: 18, g: 18, b: 16 };
const STEEL = { r: 58, g: 58, b: 54 };
const CONCRETE = { r: 90, g: 90, b: 84 };
const HOT_PINK = { r: 248, g: 29, b: 120 };

const accent = (text: string) => rgb(CHARTREUSE.r, CHARTREUSE.g, CHARTREUSE.b, text);
const bone = (text: string) => rgb(BONE.r, BONE.g, BONE.b, text);
const concrete = (text: string) => rgb(CONCRETE.r, CONCRETE.g, CONCRETE.b, text);
const steel = (text: string) => rgb(STEEL.r, STEEL.g, STEEL.b, text);
const hotPink = (text: string) => rgb(HOT_PINK.r, HOT_PINK.g, HOT_PINK.b, text);

const accentBg = (text: string) =>
	`\x1b[38;2;${VOID.r};${VOID.g};${VOID.b}m\x1b[48;2;${CHARTREUSE.r};${CHARTREUSE.g};${CHARTREUSE.b}m${text}${RESET}`;
const voidBg = (text: string) =>
	`\x1b[48;2;${VOID.r};${VOID.g};${VOID.b}m${text}${RESET}`;
const steelBg = (text: string) =>
	`\x1b[38;2;${BONE.r};${BONE.g};${BONE.b}m\x1b[48;2;${STEEL.r};${STEEL.g};${STEEL.b}m${text}${RESET}`;
const hotPinkBg = (text: string) =>
	`\x1b[38;2;${VOID.r};${VOID.g};${VOID.b}m\x1b[48;2;${HOT_PINK.r};${HOT_PINK.g};${HOT_PINK.b}m${text}${RESET}`;

// ─── Utility ─────────────────────────────────────────────────────────
function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

// ─── Header: Heavy slab ──────────────────────────────────────────────
function buildHeader(sessionName: string | undefined, cwd: string, width: number): string[] {
	const project = path.basename(cwd) || cwd;
	// Spaced caps for the project name — monumental typography
	const label = (sessionName || project).toUpperCase().split("").join(" ");
	const displayLabel = truncateToWidth(` ${label} `, width - 2, "");
	const labelWidth = visibleWidth(displayLabel);

	// 3-line solid slab: full accent bar, label line, full accent bar
	const topBar = accentBg(" ".repeat(width));
	const padRight = Math.max(0, width - labelWidth);
	const labelLine = accentBg(`${displayLabel}${" ".repeat(padRight)}`);
	const bottomBar = accentBg(" ".repeat(width));

	return [topBar, labelLine, bottomBar, ""];
}

// ─── Editor: Brutalist bordered box ──────────────────────────────────
class BrutalEditor extends CustomEditor {
	private ctx: ExtensionContext;
	private isWorking = false;
	private branch: string | undefined;
	private branchDirty = false;
	private turnCount = 0;
	private toolCount = 0;
	private stateLabel = "IDLE";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
	) {
		super(tui, theme, keybindings, { paddingX: 2 });
		this.ctx = ctx;
	}

	setWorking(w: boolean) {
		this.isWorking = w;
	}

	setBranch(b: string | undefined) {
		this.branch = b;
	}

	setBranchDirty(d: boolean) {
		this.branchDirty = d;
	}

	setTurnCount(c: number) {
		this.turnCount = c;
	}

	setToolCount(c: number) {
		this.toolCount = c;
	}

	setStateLabel(label: string) {
		this.stateLabel = label;
	}

	render(width: number): string[] {
		const lines = super.render(width - 2);
		if (lines.length < 2) return lines;

		// Border style: hard on/off based on working state
		const borderStyle = this.isWorking ? accentBg : steelBg;
		const contentBg = voidBg;

		// Add side borders to content lines
		for (let i = 1; i < lines.length - 1; i++) {
			const lineWidth = visibleWidth(lines[i]);
			const rightPad = Math.max(0, width - 2 - lineWidth);
			lines[i] = `${borderStyle(" ")}${lines[i]}${" ".repeat(rightPad)}${borderStyle(" ")}`;
		}

		// ─── TOP BAR: state label, left-aligned ───
		if (this.isWorking) {
			const label = ` ${this.stateLabel} `;
			const labelWidth = visibleWidth(label);
			const fill = Math.max(0, width - labelWidth);
			lines[0] = `${accentBg(label)}${accentBg(" ".repeat(fill))}`;
		} else {
			lines[0] = steelBg(" ".repeat(width));
		}

		// ─── BOTTOM BAR: functional data, no decoration ───
		const project = path.basename(this.ctx.cwd) || this.ctx.cwd;
		const branchStr = this.branch ? ` ${this.branch}${this.branchDirty ? "*" : ""}` : "";
		const model = this.ctx.model ? this.ctx.model.id : "—";
		const ctxUsage = this.ctx.getContextUsage();
		const contextWindow = ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const tokens = ctxUsage?.tokens != null ? `${Math.round(ctxUsage.tokens / 1000)}k` : "?";
		const ctxSize = contextWindow >= 1_000_000
			? `${(contextWindow / 1_000_000).toFixed(1)}M`
			: contextWindow >= 1_000
				? `${(contextWindow / 1_000).toFixed(0)}k`
				: `${contextWindow}`;

		const leftData = ` ${project}${branchStr} T:${this.turnCount} `;
		const rightData = ` ${tokens}/${ctxSize} ${model} `;

		const leftWidth = visibleWidth(leftData);
		const rightWidth = visibleWidth(rightData);
		const gap = Math.max(0, width - leftWidth - rightWidth);

		if (this.isWorking) {
			lines[lines.length - 1] = `${accentBg(leftData)}${accentBg(" ".repeat(gap))}${accentBg(rightData)}`;
		} else {
			lines[lines.length - 1] = `${steelBg(leftData)}${steelBg(" ".repeat(gap))}${steelBg(rightData)}`;
		}

		return lines;
	}
}

// ─── Empty footer ────────────────────────────────────────────────────
class EmptyFooter {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

// ─── Main extension ──────────────────────────────────────────────────
let globalPi: ExtensionAPI;

export default function (pi: ExtensionAPI) {
	globalPi = pi;

	let currentEditor: BrutalEditor | undefined;
	let turnCount = 0;
	let toolCount = 0;

	// ─── Session start ───────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		turnCount = 0;
		toolCount = 0;

		// Detect git branch
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

		// ── Header: heavy slab ──
		const sessionName = pi.getSessionName();
		ctx.ui.setHeader((tui, _theme) => ({
			render(width: number): string[] {
				return buildHeader(sessionName, ctx.cwd, width);
			},
			invalidate() {},
		}));

		// ── Editor: brutalist bordered box ──
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentEditor = new BrutalEditor(tui, theme, keybindings, ctx);
			return currentEditor;
		});

		// ── Footer: empty (data is in the editor bar) ──
		ctx.ui.setFooter(() => new EmptyFooter());

		// ── Title: terse ──
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — IDLE`);

		// Suppress default working indicator
		ctx.ui.setWorkingIndicator({ frames: [] });
		ctx.ui.setWorkingMessage("");
	});

	// ─── Agent start ─────────────────────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		turnCount = 0;
		toolCount = 0;
		if (currentEditor) {
			currentEditor.setWorking(true);
			currentEditor.setTurnCount(0);
			currentEditor.setToolCount(0);
			currentEditor.setStateLabel("EXEC");
		}
		ctx.ui.setWorkingIndicator({ frames: [] });
		ctx.ui.setWorkingMessage("");
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — EXEC`);
	});

	// ─── Agent end ───────────────────────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		if (currentEditor) {
			currentEditor.setWorking(false);
			currentEditor.setStateLabel("IDLE");
		}
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — DONE T:${turnCount}`);
	});

	// ─── Turn tracking ───────────────────────────────────────────────
	pi.on("turn_start", async (_event, ctx) => {
		turnCount++;
		if (currentEditor) {
			currentEditor.setTurnCount(turnCount);
			currentEditor.setStateLabel("EXEC");
		}
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — EXEC`);
	});

	// ─── Message streaming ───────────────────────────────────────────
	pi.on("message_update", async (_event, ctx) => {
		if (currentEditor) currentEditor.setStateLabel("WRITE");
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — WRITE`);
	});

	// ─── Tool tracking ───────────────────────────────────────────────
	pi.on("tool_execution_start", async (event, ctx) => {
		toolCount++;
		if (currentEditor) {
			currentEditor.setToolCount(toolCount);
			currentEditor.setStateLabel(`IO:${event.toolName.toUpperCase()}`);
		}
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — IO:${event.toolName.toUpperCase()}`);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		if (currentEditor) currentEditor.setStateLabel("EXEC");
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`${cwd} — EXEC`);
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
