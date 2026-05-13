# pi-marathon-theme

Cyberpunk UI overhaul for [pi](https://pi.dev), inspired by Marathon (2026) and 80s/90s hacking aesthetics.

Lime-green dominant, fast animations, glitch effects.

## Features

- Custom header with ASCII logo + scanline animation
- [Crush](https://github.com/charmland/crush)-inspired scrambled gradient animation widget
- Animated editor border with scrolling hex data
- Custom footer with glitch-style status readout
- Titlebar spinner with hacker flair
- Title bar with "UPLINK" / "BREACH" state indicators
- Full color theme (syntax highlighting, diffs, markdown, tool output)

## Install

```bash
pi install https://github.com/justinclayton/pi-marathon-theme
```

Then set the theme: `/settings` → theme → marathon

## Try without installing

```bash
pi -e git:github.com/justinclayton/pi-marathon-theme
```

## Commands

- `/marathon off` — disable the animated header
- `/marathon` — re-enable it

## License

MIT
