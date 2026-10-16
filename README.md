# Keycast

## Demo

[demo.webm](https://github.com/user-attachments/assets/f7aa50bc-3e11-49d3-a3b8-129dde8f0629)


## About

An on-screen keystroke HUD for screencasts on
[Omarchy](https://omarchy.org) v4 ("Quattro") with Hyprland ≥ 0.56 (Lua
config provider).

Chord chips (`Super + ⏎`, `Ctrl + C`, `A ×3`) appear at the **bottom-left**
of the focused monitor while you type, coalescing repeats, and clear after
3 s of quiet. The overlay is click-through and never takes focus.

**Hold-to-hint:** hold `Super`, `Ctrl`, `Alt` or `Shift` for half a second
and the panel lists the keybinds available with the modifiers you are
holding — read from the Omarchy keybind manager (`omarchy-keybinds list`),
so labels are the manager's own Chinese descriptions and unbound
(`disabled`) entries are skipped. Add a modifier while holding (`Super`,
then `Ctrl`) and the list narrows live. Inside each group the chords you press
most are listed first (from those usage counters), with never-used chords
falling back to digit → letter → everything else. Plain keys — no modifier held —
show nothing. Each row reads **chord · category · description** (e.g.
`Super + Ctrl + C  截图  截图/录制菜单`), the columns being measured with the
real fonts so rows stay lined up.

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

Scope controls what the chips show (`shortcuts` is the default: only chords
with `Ctrl`/`Alt`/`Super`, plus standalone function/media keys):

```sh
omarchy-shell community.keycast scopeShortcuts | scopeAll | toggleScope
omarchy-shell community.keycast hints          # current hold-to-hint rows
omarchy-shell community.keycast probe '{"Super":true,"Ctrl":true}'
```

The plugin is enabled at login: `Service.qml` ships with `enabled: true`, so
starting the shell turns the HUD on. Click the bar chip (or `disable`) to
turn it off.

## Mind your passwords

While keycast is on, **everything you type is shown on screen** — that is
the point, and it includes anything you type into password prompts.
Characters are never logged: they exist only in memory and on the overlay.
Toggle off before entering secrets.

What *is* persisted is how often a shortcut chord fired —
`~/.local/state/omarchy/keycast-usage.json` holds nothing but
`{ "Super + J": 42 }` pairs, no characters, no applications, no timestamps,
capped at the 300 busiest chords. It is what lets the hint list lead with the
shortcuts you actually use. Clear it with:



- Labels come from a static US-QWERTY base map (the compositor event
  carries only a keycode). Unknown keys render as `#<code>`.
- Hold-to-hint needs the Omarchy keybind manager (`omarchy-keybinds`) on
  `PATH`; without it the chips still work and `status` reports `bindings: 0`.
- Chords whose binding is a layer prefix (`PREFIX`, e.g. herdr) cannot be
  matched from the raw keycode stream, so they are not hinted.
- Keys consumed by Hyprland keybinds still appear (the handler sits on
  the raw event bus).

## Tests

```sh
./test/all   # node model + contract + static QML checks, manifest, qmllint
```

## License

[MIT](LICENSE)
