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
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, "");
const rgb = (r: number, g: number, b: number, text: string) =>
	`\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
const bgRgb = (r: number, g: number, b: number, text: string) =>
	`\x1b[48;2;${r};${g};${b}m${text}`;
const fgRgb = (r: number, g: number, b: number) =>
	`\x1b[38;2;${r};${g};${b}m`;

// ─── Palette system ──────────────────────────────────────────────────
interface RGB { r: number; g: number; b: number; }

// Badge: dark text on colored background
const badge = (bgR: number, bgG: number, bgB: number, text: string) =>
	`\x1b[38;2;10;10;15m\x1b[48;2;${bgR};${bgG};${bgB}m ${text} ${RESET}`;

interface AnimPalette {
	primary: (t: string) => string;
	primaryDim: (t: string) => string;
	primaryFaint: (t: string) => string;
	primaryGhost: (t: string) => string;
	danger: (t: string) => string;
	secondary: (t: string) => string;
	attention: (t: string) => string;
	hot: (t: string) => string;
	badgePrimary: (t: string) => string;
	badgeSecondary: (t: string) => string;
	badgeAttention: (t: string) => string;
	badgeHot: (t: string) => string;
	fillPrimary: (t: string) => string;
	gradientStops: RGB[];
}




// Parse RGB from an ANSI escape like "\x1b[38;2;R;G;Bm"
function parseRgbFromAnsi(ansi: string): RGB | undefined {
	const m = ansi.match(/38;2;(\d+);(\d+);(\d+)/);
	if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
	return undefined;
}

function scaleRgb(c: RGB, factor: number): RGB {
	return {
		r: Math.round(Math.min(255, c.r * factor)),
		g: Math.round(Math.min(255, c.g * factor)),
		b: Math.round(Math.min(255, c.b * factor)),
	};
}

function buildPaletteFromTheme(theme: { getFgAnsi(color: string): string; fg(color: string, text: string): string }): AnimPalette {
	const accentRgb = parseRgbFromAnsi(theme.getFgAnsi("accent" as any)) ?? { r: 57, g: 255, b: 20 };
	const successRgb = parseRgbFromAnsi(theme.getFgAnsi("success" as any)) ?? { r: 85, g: 255, b: 85 };
	const borderAccentRgb = parseRgbFromAnsi(theme.getFgAnsi("borderAccent" as any)) ?? { r: 0, g: 229, b: 255 };
	const syntaxKeywordRgb = parseRgbFromAnsi(theme.getFgAnsi("syntaxKeyword" as any)) ?? { r: 170, g: 85, b: 255 };
	const syntaxStringRgb = parseRgbFromAnsi(theme.getFgAnsi("syntaxString" as any)) ?? { r: 85, g: 255, b: 85 };
	const syntaxFunctionRgb = parseRgbFromAnsi(theme.getFgAnsi("syntaxFunction" as any)) ?? { r: 0, g: 229, b: 255 };
	const warningRgb = parseRgbFromAnsi(theme.getFgAnsi("warning" as any)) ?? { r: 255, g: 191, b: 0 };
	const errorRgb = parseRgbFromAnsi(theme.getFgAnsi("error" as any)) ?? { r: 255, g: 60, b: 60 };

	const dim = scaleRgb(accentRgb, 0.7);
	const faint = scaleRgb(accentRgb, 0.45);
	const ghost = scaleRgb(accentRgb, 0.25);

	return {
		primary: (t: string) => theme.fg("accent" as any, t),
		primaryDim: (t: string) => rgb(dim.r, dim.g, dim.b, t),
		primaryFaint: (t: string) => rgb(faint.r, faint.g, faint.b, t),
		primaryGhost: (t: string) => rgb(ghost.r, ghost.g, ghost.b, t),
		danger: (t: string) => theme.fg("borderAccent" as any, t),
		secondary: (t: string) => theme.fg("syntaxFunction" as any, t),
		attention: (t: string) => theme.fg("warning" as any, t),
		hot: (t: string) => theme.fg("error" as any, t),
		badgePrimary: (t: string) => badge(accentRgb.r, accentRgb.g, accentRgb.b, t),
		badgeSecondary: (t: string) => badge(syntaxFunctionRgb.r, syntaxFunctionRgb.g, syntaxFunctionRgb.b, t),
		badgeAttention: (t: string) => badge(warningRgb.r, warningRgb.g, warningRgb.b, t),
		badgeHot: (t: string) => badge(errorRgb.r, errorRgb.g, errorRgb.b, t),
		fillPrimary: (t: string) => `\x1b[48;2;${accentRgb.r};${accentRgb.g};${accentRgb.b}m${t}${RESET}`,
		// Scramble the theme's key colors together (skip warning/error — they intentionally break vibe)
		gradientStops: [
			accentRgb,
			successRgb,
			borderAccentRgb,
			syntaxKeywordRgb,
			syntaxStringRgb,
			accentRgb, // wrap back
		],
	};
}

function getPaletteForTheme(_themeName: string | undefined, theme?: any): AnimPalette {
	if (theme) return buildPaletteFromTheme(theme);
	// Fallback: build a basic green palette if no theme object available
	return {
		primary: (t: string) => rgb(57, 255, 20, t),
		primaryDim: (t: string) => rgb(40, 178, 14, t),
		primaryFaint: (t: string) => rgb(26, 115, 9, t),
		primaryGhost: (t: string) => rgb(14, 64, 5, t),
		danger: (t: string) => rgb(255, 60, 60, t),
		secondary: (t: string) => rgb(0, 229, 255, t),
		attention: (t: string) => rgb(255, 191, 0, t),
		hot: (t: string) => rgb(255, 60, 60, t),
		badgePrimary: (t: string) => badge(57, 255, 20, t),
		badgeSecondary: (t: string) => badge(0, 229, 255, t),
		badgeAttention: (t: string) => badge(255, 191, 0, t),
		badgeHot: (t: string) => badge(255, 60, 60, t),
		fillPrimary: (t: string) => `\x1b[48;2;57;255;20m${t}${RESET}`,
		gradientStops: [
			{ r: 57, g: 255, b: 20 },
			{ r: 57, g: 255, b: 20 },
		],
	};
}

// Active palette (updated on theme change based on active theme tokens)
let palette: AnimPalette = getPaletteForTheme(undefined);

// Legacy aliases that delegate to active palette
const PRIMARY = (t: string) => palette.primary(t);
const PRIMARY_DIM = (t: string) => palette.primaryDim(t);
const PRIMARY_FAINT = (t: string) => palette.primaryFaint(t);
const PRIMARY_GHOST = (t: string) => palette.primaryGhost(t);
const DANGER = (t: string) => palette.danger(t);
const SECONDARY = (t: string) => palette.secondary(t);
const ATTENTION = (t: string) => palette.attention(t);
const HOT = (t: string) => palette.hot(t);
const BADGE_PRIMARY = (t: string) => palette.badgePrimary(t);
const BADGE_SECONDARY = (t: string) => palette.badgeSecondary(t);
const BADGE_ATTENTION = (t: string) => palette.badgeAttention(t);
const BADGE_HOT = (t: string) => palette.badgeHot(t);
const FILL_PRIMARY = (t: string) => palette.fillPrimary(t);
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
// Gradient cycling colors — pulled from active palette

function lerpColor(a: RGB, b: RGB, t: number): RGB {
	return {
		r: Math.round(a.r + (b.r - a.r) * t),
		g: Math.round(a.g + (b.g - a.g) * t),
		b: Math.round(a.b + (b.b - a.b) * t),
	};
}

function buildGradientRamp(size: number, stops?: RGB[]): RGB[] {
	const gradientStops = stops ?? palette.gradientStops;
	const ramp: RGB[] = [];
	const segments = gradientStops.length - 1;
	for (let i = 0; i < size; i++) {
		const t = (i / size) * segments;
		const seg = Math.min(Math.floor(t), segments - 1);
		const local = t - seg;
		ramp.push(lerpColor(gradientStops[seg]!, gradientStops[seg + 1]!, local));
	}
	return ramp;
}

// ─── Crush-style scrambled gradient animation ────────────────────────
const ANIM_WIDTH = 10; // number of cycling characters
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
		this.gradientRamp = buildGradientRamp(width * 3, palette.gradientStops);
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
			const labelColor = PRIMARY_DIM;
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

	rebuildGradient() {
		this.gradientRamp = buildGradientRamp(this.width * 3, palette.gradientStops);
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
			lines.push(PRIMARY(logo[i]!));
		} else if (Math.abs(i - scanlineRow) === 1) {
			lines.push(PRIMARY_DIM(logo[i]!));
		} else {
			lines.push(PRIMARY_FAINT(logo[i]!));
		}
	}

	const hex1 = PRIMARY_GHOST(randomHex(4));
	const hex2 = PRIMARY_GHOST(randomHex(4));
	const subtitle = `  ${hex1} ${PRIMARY_DIM("▸ RUNNER TERMINAL v2.026")} ${hex2}`;
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
	if (width === 1) return border("█");

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
		return `${border("█")}${leftText}${fill("█".repeat(filledWidth))}${fillLabel}${border("█".repeat(emptyWidth))}${rightText}${border("█")}`;
	}
	return `${border("█")}${leftText}${fill("█".repeat(gapWidth))}${rightText}${border("█")}`;
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
	private workingStartFrame = 0;
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
		super(tui, theme, keybindings, { paddingX: 2 });
		this.ctx = ctx;
		this.isWorking = isWorking;
		this.branch = branch;
		this.branchDirty = branchDirty;
		this.scrambleL = scrambleL;
		this.scrambleR = scrambleR;

		// Animation timer is managed externally via startAnimation()/stopAnimation()
		// to prevent constant re-renders from fighting scroll position when idle.
		this.animTimer = undefined;
	}

	setWorking(w: boolean) {
		if (w && !this.isWorking) {
			this.workingStartFrame = this.frame;
		}
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
		this.stopAnimation();
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	startAnimation(): void {
		if (this.animTimer) return;
		this.animTimer = setInterval(() => {
			this.frame++;
			if (this.isWorking) {
				this.scrambleL.tick();
				this.scrambleR.tick();
			}
			this.tui.requestRender();
		}, ANIM_INTERVAL);
	}

	stopAnimation(): void {
		if (this.animTimer) {
			clearInterval(this.animTimer);
			this.animTimer = undefined;
		}
	}

	render(width: number): string[] {
		const contentLines = super.render(width - 2);
		if (contentLines.length < 2) return contentLines;

		// Compute pulse state for the entire box
		let fillBg = FILL_PRIMARY;
		let darkOnPulse = (text: string) => text;
		if (this.isWorking) {
			const pulseSpeed = 0.06;
			const elapsed = this.frame - this.workingStartFrame;
			const t = (Math.sin(elapsed * pulseSpeed + Math.PI / 2) + 1) / 2;
			const accentAnsi = this.ctx.ui.theme.getFgAnsi("accent" as any);
			const accentCol = parseRgbFromAnsi(accentAnsi) ?? { r: 57, g: 255, b: 20 };
			const scale = 0.45 + t * 0.55;
			const r = Math.round(accentCol.r * scale);
			const g = Math.round(accentCol.g * scale);
			const b = Math.round(accentCol.b * scale);
			fillBg = (text: string) => `\x1b[48;2;${r};${g};${b}m${text}${RESET}`;
			darkOnPulse = (text: string) => `\x1b[38;2;10;10;15m\x1b[48;2;${r};${g};${b}m${text}${RESET}`;
		}

		// Build entirely NEW output array — never mutate contentLines
		const output: string[] = [];

		// (1) Top border: pulsing bar with centered label when working, solid when idle
		if (this.isWorking) {
			const labelText = BADGE_HOT(`▸▸ ${this.scrambleLabel} ◂◂`);
			const labelWidth = visibleWidth(labelText);
			const remaining = width - labelWidth;
			const padLeft = Math.floor(remaining / 2);
			const padRight = remaining - padLeft;
			output.push(`${fillBg(" ".repeat(padLeft))}${labelText}${fillBg(" ".repeat(padRight))}`);
		} else {
			output.push(fillBg(" ".repeat(width)));
		}

		// (2) Content lines with left/right side borders
		//     Skip index 0 (now top border) and index N-1 (input/status line)
		for (let i = 1; i < contentLines.length - 1; i++) {
			const lineWidth = visibleWidth(contentLines[i]);
			const rightPad = Math.max(0, width - 2 - lineWidth);
			output.push(`${fillBg(" ")}${contentLines[i]}${" ".repeat(rightPad)}${fillBg(" ")}`);
		}

		// (3) Bottom status bar: cwd | branch | turns ── fill ── pct/size | model (thinking)
		const cwdBase = path.basename(this.ctx.cwd) || this.ctx.cwd;
		const branchName = this.branch ? `${this.branch}${this.branchDirty ? "*" : ""}` : "";
		const branchColor = this.branchDirty ? BADGE_HOT : BADGE_SECONDARY;
		const model = this.ctx.model ? this.ctx.model.id : "NO_MODEL";
		const thinking = (globalPi as ExtensionAPI).getThinkingLevel().toUpperCase();
		const ctxUsage = this.ctx.getContextUsage();
		const contextWindow = ctxUsage?.contextWindow ?? this.ctx.model?.contextWindow ?? 0;
		const ctxTokens = ctxUsage?.tokens != null ? `${Math.round(ctxUsage.tokens / 1000)}k` : "?";
		const ctxSize = contextWindow >= 1_000_000 ? `${(contextWindow / 1_000_000).toFixed(1)}M` : contextWindow >= 1_000 ? `${(contextWindow / 1_000).toFixed(0)}k` : `${contextWindow}`;

		const bottomLeft = `${fillBg(" ")}${BADGE_SECONDARY(cwdBase)}${branchName ? `${branchColor(branchName)}` : ""}${BADGE_ATTENTION(`T:${this.turnCount}`)}`;
		const bottomRight = `${BADGE_ATTENTION(`${ctxTokens}/${ctxSize}`)}${BADGE_HOT(model)}${BADGE_SECONDARY(thinking)}${fillBg(" ")}`;

		// Fill the gap with scramble widget when working, dark space when idle
		const bottomLeftWidth = visibleWidth(bottomLeft);
		const bottomRightWidth = visibleWidth(bottomRight);
		const gap = Math.max(0, width - bottomLeftWidth - bottomRightWidth);

		if (this.isWorking && gap > 0) {
			// Fill gap with scramble text
			const rawL = stripAnsi(this.scrambleL.render());
			const rawR = stripAnsi(this.scrambleR.render());
			const raw = (rawL + rawR).repeat(Math.ceil(gap / Math.max(1, rawL.length + rawR.length))).slice(0, gap);
			output.push(`${bottomLeft}${darkOnPulse(raw)}${bottomRight}`);
		} else {
			output.push(`${bottomLeft}${" ".repeat(gap)}${bottomRight}`);
		}

		// (4) Solid bottom border line
		output.push(fillBg(" ".repeat(width)));

		return output;
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

		// Detect active theme and set palette
		const themeName = ctx.ui.theme?.name;
		palette = getPaletteForTheme(themeName, ctx.ui.theme);
		scrambleL.rebuildGradient();
		scrambleR.rebuildGradient();

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
		currentEditor?.startAnimation();

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
		currentEditor?.stopAnimation();

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
