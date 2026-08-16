# Keycast

An on-screen keystroke HUD for screencasts on
[Omarchy](https://omarchy.org) v4 ("Quattro") with Hyprland ≥ 0.56 (Lua
config provider).

Chord chips (`Super + ⏎`, `Ctrl + C`, `A ×3`) fade in above the bottom of
the focused monitor while you type, coalescing repeats, and clear after
3 s of quiet. The overlay is click-through and never takes focus.

**How it works:** Hyprland 0.56's Lua config bus exposes an
`input.keyboard.key` event. Toggling keycast on registers a one-line
handler through `hyprctl repl` that re-emits each event as a socket2
custom event, which the shell consumes reactively. No `/dev/input`
access, no polling, no daemon — and toggling off removes the handler, so
the compositor does zero per-key work while keycast is off. The handler
survives config reloads (it re-registers on `configreloaded`).

## Install

```sh
omarchy plugin add https://github.com/devmobasa/omarchy-keycast --enable
```

Toggle from the bar chip (`󰌌`) or by IPC / keybind:

```sh
omarchy-shell community.keycast toggle | enable | disable | status
```

## Mind your passwords

While keycast is on, **everything you type is shown on screen** — that is
the point, and it includes anything you type into password prompts.
Keystrokes are never logged or written to disk; they exist only in memory
and on the overlay. Toggle off before entering secrets.

## Caveats

- Labels come from a static US-QWERTY base map (the compositor event
  carries only a keycode). Unknown keys render as `#<code>`.
- Keys consumed by Hyprland keybinds still appear (the handler sits on
  the raw event bus).

## Tests

```sh
./test/all   # node model + contract + static QML checks, manifest, qmllint
```

## License

[MIT](LICENSE)
