/**
 * Marathon Theme Extension
 *
 * Cyberpunk UI overhaul inspired by Marathon (2026) and 80s/90s hacking aesthetics.
 * Lime-green dominant, fast animations, glitch effects.
 *
 * Features:
 *   - Custom header with Marathon-style ASCII logo + scanline animation
 *   - Crush-style scrambled gradient animation widget (below editor, anchored)
 *   - Animated editor border with scrolling hex data
 *   - Custom footer with glitch-style status readout
 *   - Titlebar spinner with hacker flair
 *   - Title bar with "UPLINK" / "BREACH" state indicators
 *
 * Install:
 *   pi install https://github.com/justinclayton/pi-marathon-theme
 *
 * Pair with the "marathon" theme for full effect: /settings → theme → marathon
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

// Marathon palette - raw ANSI (theme-independent for animations)
const LIME = (t: string) => rgb(57, 255, 20, t);
const LIME_DIM = (t: string) => rgb(46, 184, 46, t);
const LIME_FAINT = (t: string) => rgb(30, 120, 30, t);
const LIME_GHOST = (t: string) => rgb(20, 70, 20, t);
const PINK = (t: string) => rgb(255, 110, 199, t);
const CYAN = (t: string) => rgb(0, 229, 255, t);
const PURPLE = (t: string) => rgb(191, 95, 255, t);
const BLUE = (t: string) => rgb(68, 136, 255, t);
const DARK_BG = (t: string) => bgRgb(10, 10, 15, t);

// ─── Hacker glyphs ───────────────────────────────────────────────────
const HEX_CHARS = "0123456789abcdef";
const SCRAMBLE_CHARS = "0123456789abcdefABCDEF~!@#$%^&*()+=_<>|░▒▓█▌▐╌╍";
const SCANLINE_CHARS = "═─━┈┉╌╍";
const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function randomHex(len: number): string {
	let s = "";
	for (let i = 0; i < len; i++) s += HEX_CHARS[Math.floor(Math.random() * 16)];
	return s;
}

function randomScrambleChar(): string {
	return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]!;
}

// ─── HCL-ish gradient (simplified for terminal) ─────────────────────
// Marathon palette gradient: lime → cyan → purple → pink → lime (cycling)
interface RGB { r: number; g: number; b: number; }

const GRADIENT_STOPS: RGB[] = [
	{ r: 57,  g: 255, b: 20  }, // lime
	{ r: 30,  g: 200, b: 100 }, // teal-green
	{ r: 0,   g: 229, b: 255 }, // cyan
	{ r: 30,  g: 200, b: 100 }, // teal-green
	{ r: 57,  g: 255, b: 20  }, // lime (wrap)
];

function lerpColor(a: RGB, b: RGB, t: number): RGB {
	return {
		r: Math.round(a.r + (b.r - a.r) * t),
		g: Math.round(a.g + (b.g - a.g) * t),
		b: Math.round(a.b + (b.b - a.b) * t),
	};
}

function buildGradientRamp(size: number): RGB[] {
	const ramp: RGB[] = [];
	const segments = GRADIENT_STOPS.length - 1;
	for (let i = 0; i < size; i++) {
		const t = (i / size) * segments;
		const seg = Math.min(Math.floor(t), segments - 1);
		const local = t - seg;
		ramp.push(lerpColor(GRADIENT_STOPS[seg]!, GRADIENT_STOPS[seg + 1]!, local));
	}
	return ramp;
}

// ─── Crush-style scrambled gradient animation ────────────────────────
const ANIM_WIDTH = 20; // number of cycling characters
const ANIM_FPS = 20;
const ANIM_INTERVAL = Math.round(1000 / ANIM_FPS); // ~50ms
const LABEL_GAP = " ";
const ELLIPSIS_FRAMES = [".", "..", "...", ""];
const ELLIPSIS_SPEED = 8; // frames per ellipsis step
const MAX_BIRTH_OFFSET = 1000; // ms, staggered entrance

class ScrambleAnim {
	private width: number;
	private gradientRamp: RGB[];
	private birthOffsets: number[];
	private startTime: number;
	private step = 0;
	private ellipsisStep = 0;
	private initialized = false;
	private label = "BREACH";

	constructor(width: number = ANIM_WIDTH) {
		this.width = width;
		// Build a wider gradient for cycling (3x width for smooth scroll)
		this.gradientRamp = buildGradientRamp(width * 3);
		this.birthOffsets = [];
		for (let i = 0; i < width; i++) {
			this.birthOffsets.push(Math.random() * MAX_BIRTH_OFFSET);
		}
		this.startTime = Date.now();
	}

	setLabel(label: string) {
		this.label = label;
	}

	tick() {
		this.step++;
		this.ellipsisStep++;
		if (!this.initialized && Date.now() - this.startTime >= MAX_BIRTH_OFFSET) {
			this.initialized = true;
		}
	}

	render(): string {
		const elapsed = Date.now() - this.startTime;
		const offset = this.step % this.gradientRamp.length;
		let out = "";

		// Cycling scramble characters with gradient
		for (let i = 0; i < this.width; i++) {
			const colorIdx = (i + offset) % this.gradientRamp.length;
			const c = this.gradientRamp[colorIdx]!;

			if (!this.initialized && elapsed < this.birthOffsets[i]!) {
				// Birth not reached: show initial dot
				out += `${fgRgb(c.r, c.g, c.b)}.${RESET}`;
			} else {
				// Random cycling character
				const ch = randomScrambleChar();
				out += `${fgRgb(c.r, c.g, c.b)}${ch}${RESET}`;
			}
		}

		// Label with animated ellipsis
		if (this.label) {
			const labelColor = LIME_DIM;
			const ellipsisIdx = Math.floor(this.ellipsisStep / ELLIPSIS_SPEED) % ELLIPSIS_FRAMES.length;
			const dots = ELLIPSIS_FRAMES[ellipsisIdx]!;
			out += LABEL_GAP + labelColor(this.label + dots);
		}

		return out;
	}

	reset() {
		this.step = 0;
		this.ellipsisStep = 0;
		this.initialized = false;
		this.startTime = Date.now();
		// Regenerate birth offsets for fresh stagger
		for (let i = 0; i < this.width; i++) {
			this.birthOffsets[i] = Math.random() * MAX_BIRTH_OFFSET;
		}
	}
}

// ─── Header: Marathon-style logo ─────────────────────────────────────
function buildHeader(theme: { fg: (c: string, t: string) => string; bold: (t: string) => string }, frame: number): string[] {
	const logo = [
		"  ██████╗ ██╗       ██████╗ ███████╗██╗   ██╗",
		"  ██╔══██╗██║       ██╔══██╗██╔════╝██║   ██║",
		"  ██████╔╝██║       ██║  ██║█████╗  ██║   ██║",
		"  ██╔═══╝ ██║  ██╗  ██║  ██║██╔══╝  ╚██╗ ██╔╝",
		"  ██║     ██║  ╚═╝  ██████╔╝███████╗ ╚████╔╝ ",
		"  ╚═╝     ╚═╝       ╚═════╝ ╚══════╝  ╚═══╝  ",
	];

	const scanlineRow = frame % (logo.length + 4);
	const lines: string[] = [""];

	for (let i = 0; i < logo.length; i++) {
		if (i === scanlineRow) {
			lines.push(LIME(logo[i]!));
		} else if (Math.abs(i - scanlineRow) === 1) {
			lines.push(LIME_DIM(logo[i]!));
		} else {
			lines.push(LIME_FAINT(logo[i]!));
		}
	}

	const hex1 = LIME_GHOST(randomHex(4));
	const hex2 = LIME_GHOST(randomHex(4));
	const subtitle = `  ${hex1} ${LIME_DIM("▸ RUNNER TERMINAL v2.026")} ${hex2}`;
	lines.push("");
	lines.push(subtitle);
	lines.push("");
	return lines;
}

// ─── Editor: Custom border ───────────────────────────────────────────
function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!contextWindow || !usage || usage.percent === null) return "??%";
	return `${Math.round(usage.percent)}%`;
}

function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
	fillPercent?: number,
	fillLabel?: string,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2;
	const minimumGap = 3;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(0, width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText));
	if (fillPercent !== undefined && fillLabel && gapWidth > 0) {
		const labelWidth = visibleWidth(fillLabel);
		const barWidth = Math.max(0, gapWidth - labelWidth);
		const filledWidth = Math.round(barWidth * Math.min(1, Math.max(0, fillPercent / 100)));
		const emptyWidth = barWidth - filledWidth;
		return `${border("─")}${leftText}${fill("█".repeat(filledWidth))}${fillLabel}${border("─".repeat(emptyWidth))}${rightText}${border("─")}`;
	}
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

// Hex data stream for the top border
function hexStream(frame: number, width: number): string {
	const totalHex = width * 2;
	let stream = "";
	for (let i = 0; i < totalHex; i++) {
		const idx = (i + frame * 2) % 16;
		stream += HEX_CHARS[idx];
	}
	const offset = (frame * 3) % stream.length;
	const visible = stream.slice(offset, offset + Math.max(0, width - 4));
	return visible.padEnd(Math.max(0, width - 4), "0");
}

class MarathonEditor extends CustomEditor {
	private animTimer?: ReturnType<typeof setInterval>;
	private frame = 0;
	private isWorking = false;
	private ctx: ExtensionContext;
	private branch: string | undefined;
	private branchDirty = false;
	private turnCount = 0;
	private scrambleL: ScrambleAnim;
	private scrambleR: ScrambleAnim;
	private scrambleLabel = "";

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		ctx: ExtensionContext,
		isWorking: boolean,
		branch: string | undefined,
		branchDirty: boolean,
		scrambleL: ScrambleAnim,
		scrambleR: ScrambleAnim,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.ctx = ctx;
		this.isWorking = isWorking;
		this.branch = branch;
		this.branchDirty = branchDirty;
		this.scrambleL = scrambleL;
		this.scrambleR = scrambleR;

		// Fast animation tick — matches ANIM_INTERVAL for smooth scramble
		this.animTimer = setInterval(() => {
			this.frame++;
			if (this.isWorking) {
				this.scrambleL.tick();
				this.scrambleR.tick();
			}
			tui.requestRender();
		}, ANIM_INTERVAL);
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

	setScrambleLabel(label: string) {
		this.scrambleLabel = label;
	}

	dispose() {
		if (this.animTimer) {
			clearInterval(this.animTimer);
			this.animTimer = undefined;
		}
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length < 2) return lines;

		const borderColor = (text: string) => this.borderColor(text);

		// ─── TOP BORDER: scramble | label | scramble when working, LIME_GHOST when idle ───
		if (this.isWorking) {
			const labelText = LIME_DIM(` ▸▸ ${this.scrambleLabel} ◂◂ `);
			const labelWidth = visibleWidth(labelText);
			const scrambleL = this.scrambleL.render();
			const scrambleR = this.scrambleR.render();
			const scrambleLWidth = visibleWidth(scrambleL);
			const scrambleRWidth = visibleWidth(scrambleR);
			const contentWidth = scrambleLWidth + labelWidth + scrambleRWidth;

			if (contentWidth + 2 <= width) {
				// Pad with border chars to fill width
				const remaining = width - contentWidth - 2;
				const padLeft = Math.floor(remaining / 2);
				const padRight = remaining - padLeft;
				lines[0] = `${LIME_GHOST("─")}${LIME_GHOST("─".repeat(padLeft))}${scrambleL}${labelText}${scrambleR}${LIME_GHOST("─".repeat(padRight))}${LIME_GHOST("─")}`;
			} else {
				// Fallback: just the label centered
				lines[0] = fitBorder(labelText, "", width, borderColor, (_t) => LIME_GHOST("─"));
			}
		} else {
			// Idle: plain LIME_GHOST border
			lines[0] = LIME_GHOST("─".repeat(width));
		}

		// ─── BOTTOM BORDER: cwd | branch | turns ── fill ── pct/size | model (thinking) ───
		const cwdBase = path.basename(this.ctx.cwd) || this.ctx.cwd;
		const branchName = this.branch ? `${this.branch}${this.branchDirty ? "*" : ""}` : "";
		const branchColor = this.branchDirty ? PINK : LIME;
		const model = this.ctx.model ? this.ctx.model.id : "NO_MODEL";
		const thinking = (globalPi as ExtensionAPI).getThinkingLevel().toUpperCase();
		const ctxUsage = this.ctx.getContextUsage();
		const ctxPct = ctxUsage?.percent !== null && ctxUsage?.percent !== undefined ? ctxUsage.percent.toFixed(1) : "?";
		const contextWindow = ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const ctxSize = contextWindow >= 1_000_000 ? `${(contextWindow / 1_000_000).toFixed(1)}M` : contextWindow >= 1_000 ? `${(contextWindow / 1_000).toFixed(0)}K` : `${contextWindow}`;

		const bottomLeft = ` ${LIME_DIM(cwdBase)}${branchName ? ` ${LIME_GHOST("│")} ${branchColor(branchName)}` : ""} ${LIME_GHOST("│")} ${LIME_FAINT(`T:${this.turnCount}`)} `;
		const bottomRight = ` ${LIME_FAINT(`${ctxPct}%/${ctxSize}`)} ${LIME_GHOST("│")} ${LIME_DIM(model)} ${LIME_FAINT(`(${thinking})`)} `;

		lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, borderColor, (t) => LIME_GHOST(t));

		return lines;
	}
}

// Module-level ref to pi for getThinkingLevel in the editor
let globalPi: ExtensionAPI;

// ─── Empty footer component (we use setFooter instead) ───────────────
class EmptyFooter {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

// ─── Main extension ──────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	globalPi = pi;

	let isWorking = false;
	let headerFrame = 0;
	let headerTimer: ReturnType<typeof setInterval> | undefined;
	let currentEditor: MarathonEditor | undefined;
	let turnCount = 0;
	let toolCount = 0;

	// Scramble animation for the below-editor widget
	const scrambleL = new ScrambleAnim(ANIM_WIDTH);
	const scrambleR = new ScrambleAnim(ANIM_WIDTH);
	let currentCtx: ExtensionContext | undefined;

	// ─── Scramble widget management ──────────────────────────────────
	let scrambleLabel = "BREACH";

	function startScrambleWidget(ctx: ExtensionContext, label: string) {
		scrambleLabel = label;
		scrambleL.setLabel("");
		scrambleL.reset();
		scrambleR.setLabel("");
		scrambleR.reset();
		if (currentEditor) currentEditor.setScrambleLabel(label);
		ctx.ui.setWorkingIndicator({ frames: [] });
		ctx.ui.setWorkingMessage("");
	}

	function updateScrambleLabel(ctx: ExtensionContext, label: string) {
		scrambleLabel = label;
		if (currentEditor) currentEditor.setScrambleLabel(label);
	}

	function stopScrambleWidget(ctx: ExtensionContext) {
		// Nothing to clean up — editor handles rendering
	}

	// ─── Animated header ─────────────────────────────────────────────
	const startHeaderAnimation = () => {
		if (headerTimer) clearInterval(headerTimer);
		headerTimer = setInterval(() => {
			headerFrame++;
		}, 150);
	};

	// ─── Setup on session start ──────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		currentCtx = ctx;
		turnCount = 0;
		toolCount = 0;

		// Detect git branch and dirty state
		let branch: string | undefined;
		let branchDirty = false;
		const refreshBranch = async () => {
			const result = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd }).catch(() => undefined);
			const stdout = result?.stdout.trim();
			branch = stdout && stdout.length > 0 ? stdout : undefined;
			if (currentEditor) currentEditor.setBranch(branch);
		};
		const refreshDirty = async () => {
			const result = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
			branchDirty = !!(result?.stdout && result.stdout.trim().length > 0);
			if (currentEditor) currentEditor.setBranchDirty(branchDirty);
		};
		void refreshBranch();
		void refreshDirty();

		// ── Header: Marathon ASCII logo with scanline ──
		startHeaderAnimation();
		ctx.ui.setHeader((tui, theme) => {
			return {
				render(width: number): string[] {
					const headerLines = buildHeader(theme, headerFrame);
					return headerLines.map((l) => truncateToWidth(l, width));
				},
				invalidate() {},
			};
		});

		// ── Editor: custom border with hex stream ──
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentEditor = new MarathonEditor(tui, theme, keybindings, ctx, isWorking, branch, branchDirty, scrambleL, scrambleR);
			return currentEditor;
		});

		// ── Footer: replaced with empty (info is in editor border) ──
		ctx.ui.setFooter(() => new EmptyFooter());

		// ── Title: UPLINK ready ──
		const cwd = path.basename(process.cwd());
		const session = pi.getSessionName();
		ctx.ui.setTitle(session ? `◈ READY // ${session} // ${cwd}` : `◈ READY // ${cwd}`);
	});

	// ─── Agent start: breach mode ────────────────────────────────────
	pi.on("agent_start", async (_event, ctx) => {
		isWorking = true;
		turnCount = 0;
		toolCount = 0;
		if (currentEditor) {
			currentEditor.setWorking(true);
			currentEditor.setTurnCount(0);
		}

		// Start the Crush-style scramble widget
		startScrambleWidget(ctx, "BREACH");

		// Title: breach mode
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`⟐ THINKING // ${cwd}`);
	});

	// ─── Agent end: uplink restored ──────────────────────────────────
	pi.on("agent_end", async (_event, ctx) => {
		isWorking = false;
		if (currentEditor) currentEditor.setWorking(false);

		// Stop the scramble widget
		stopScrambleWidget(ctx);

		const summary = `T:${turnCount} OPS:${toolCount}`;
		const cwd = path.basename(process.cwd());
		const session = pi.getSessionName();
		ctx.ui.setTitle(session ? `◈ READY // ${summary} // ${session} // ${cwd}` : `◈ READY // ${summary} // ${cwd}`);
	});

	// ─── Turn tracking ───────────────────────────────────────────────
	pi.on("turn_start", async (_event, ctx) => {
		turnCount++;
		if (currentEditor) currentEditor.setTurnCount(turnCount);
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`⟐ THINKING // ${cwd}`);
		updateScrambleLabel(ctx, "THINKING");
	});

	// ─── Message streaming: writing mode ─────────────────────────────
	pi.on("message_update", async (_event, ctx) => {
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`⟐ WRITING // ${cwd}`);
		updateScrambleLabel(ctx, "WRITING");
	});

	// ─── Tool tracking ───────────────────────────────────────────────
	pi.on("tool_execution_start", async (event, ctx) => {
		toolCount++;
		const toolLabel = event.toolName.toUpperCase();
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`⟐ OP:${toolLabel} // ${cwd}`);
		updateScrambleLabel(ctx, `OP:${toolLabel}`);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		const cwd = path.basename(process.cwd());
		ctx.ui.setTitle(`⟐ THINKING // ${cwd}`);
		updateScrambleLabel(ctx, "THINKING");
		// Refresh dirty state after tool executions (files may have changed)
		const dirtyResult = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd }).catch(() => undefined);
		const dirty = !!(dirtyResult?.stdout && dirtyResult.stdout.trim().length > 0);
		if (currentEditor) currentEditor.setBranchDirty(dirty);
	});

	// ─── Cleanup ─────────────────────────────────────────────────────
	pi.on("session_shutdown", async (_event, ctx) => {
		if (headerTimer) {
			clearInterval(headerTimer);
			headerTimer = undefined;
		}
		if (currentEditor) {
			currentEditor.dispose();
			currentEditor = undefined;
		}
		currentCtx = undefined;
	});

	// ─── Command: toggle header ──────────────────────────────────────
	pi.registerCommand("marathon", {
		description: "Toggle Marathon hacker header on/off",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "off") {
				ctx.ui.setHeader(undefined);
				if (headerTimer) {
					clearInterval(headerTimer);
					headerTimer = undefined;
				}
				ctx.ui.notify("Marathon header disabled", "info");
			} else {
				startHeaderAnimation();
				ctx.ui.setHeader((tui, theme) => ({
					render(width: number): string[] {
						return buildHeader(theme, headerFrame).map((l) => truncateToWidth(l, width));
					},
					invalidate() {},
				}));
				ctx.ui.notify("Marathon header enabled", "info");
			}
		},
	});
}
