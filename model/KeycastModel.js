// Keycast model. Loaded by both QML and the Node test harness;
// dependency-free.
//
// The event source is Hyprland 0.56's Lua `input.keyboard.key` bus event
// (xkb keycode = evdev + 8, time ms, state). A minimal handler registered
// through `hyprctl repl` re-emits each event as a socket2 custom event
// (`custom>>keycast,<keycode>,<state>`), which Quickshell receives via
// Hyprland.rawEvent — zero polling, zero config-file changes, and the
// compositor does no per-key work at all while no handler is registered.
// The repl Lua VM drops the subscription on every config reload, so the
// service re-registers on configreloaded. Nothing is ever written to disk.

// The handler stays one expression deep: Lua event callbacks run on the
// compositor thread under a watchdog.
var REGISTER_LUA = 'KEYCAST_SUB = hl.on("input.keyboard.key", function(kc, t, state) '
  + 'hl.dispatch(hl.dsp.event("keycast," .. kc .. "," .. state)) end)'
var UNREGISTER_LUA = 'if KEYCAST_SUB then KEYCAST_SUB:remove() KEYCAST_SUB = nil end'
var PROBE_LUA = 'return tostring(KEYCAST_SUB)'

var MAX_ENTRIES = 5

function replCommand(lua) {
  return ["hyprctl", "repl", lua]
}

// `custom>>keycast,<xkb-keycode>,<state>` — state 1 press, 0 release.
function parseEvent(data) {
  var parts = String(data == null ? "" : data).split(",")
  if (parts.length !== 3 || parts[0] !== "keycast") return null
  var keycode = Number(parts[1])
  if (!isFinite(keycode) || keycode <= 8 || keycode !== Math.floor(keycode)) return null
  if (parts[2] !== "0" && parts[2] !== "1") return null
  return { keycode: keycode, pressed: parts[2] === "1" }
}

// evdev code -> label (xkb keycode - 8). A static US-layout base map:
// good enough for a screencast HUD; unknown codes render as #<code>.
var EVDEV_LABELS = {
  1: "Esc", 2: "1", 3: "2", 4: "3", 5: "4", 6: "5", 7: "6", 8: "7", 9: "8",
  10: "9", 11: "0", 12: "-", 13: "=", 14: "⌫", 15: "⇥",
  16: "Q", 17: "W", 18: "E", 19: "R", 20: "T", 21: "Y", 22: "U", 23: "I",
  24: "O", 25: "P", 26: "[", 27: "]", 28: "⏎",
  30: "A", 31: "S", 32: "D", 33: "F", 34: "G", 35: "H", 36: "J", 37: "K",
  38: "L", 39: ";", 40: "'", 41: "`", 43: "\\",
  44: "Z", 45: "X", 46: "C", 47: "V", 48: "B", 49: "N", 50: "M",
  51: ",", 52: ".", 53: "/", 55: "*", 57: "Space", 58: "Caps",
  59: "F1", 60: "F2", 61: "F3", 62: "F4", 63: "F5", 64: "F6", 65: "F7",
  66: "F8", 67: "F9", 68: "F10", 87: "F11", 88: "F12",
  96: "⏎", 102: "Home", 103: "↑", 104: "PgUp", 105: "←", 106: "→",
  107: "End", 108: "↓", 109: "PgDn", 110: "Ins", 111: "Del", 119: "Pause",
  99: "PrtSc", 127: "Menu"
}

// evdev modifier codes.
var MODIFIERS = {
  29: "Ctrl", 97: "Ctrl",
  42: "Shift", 54: "Shift",
  56: "Alt", 100: "Alt",
  125: "Super", 126: "Super"
}

function evdevCode(xkbKeycode) {
  return xkbKeycode - 8
}

function isModifier(xkbKeycode) {
  return MODIFIERS[evdevCode(xkbKeycode)] !== undefined
}

function modifierName(xkbKeycode) {
  return MODIFIERS[evdevCode(xkbKeycode)] || ""
}

function keyLabel(xkbKeycode) {
  var code = evdevCode(xkbKeycode)
  return EVDEV_LABELS[code] || ("#" + code)
}

function emptyState() {
  return { mods: {}, entries: [] }
}

// Shift is implied by what a printable key types, so it only shows for
// named/special keys.
function shiftImplied(label) {
  return /^[A-Z0-9`\-=\[\]\\;',.\/*]$/.test(label)
}

function chordText(mods, label) {
  var parts = []
  if (mods["Super"]) parts.push("Super")
  if (mods["Ctrl"]) parts.push("Ctrl")
  if (mods["Alt"]) parts.push("Alt")
  if (mods["Shift"] && !shiftImplied(label)) parts.push("Shift")
  parts.push(label)
  return parts.join(" + ")
}

// Pure reducer: modifier presses update the held-mod set; other presses
// append a chord entry (repeats coalesce into ×N). Entries cap at
// MAX_ENTRIES, oldest dropped.
function applyEvent(state, event) {
  var mods = {}
  for (var key in state.mods) mods[key] = state.mods[key]
  var entries = state.entries.slice()
  if (isModifier(event.keycode)) {
    if (event.pressed) mods[modifierName(event.keycode)] = true
    else delete mods[modifierName(event.keycode)]
    return { mods: mods, entries: entries }
  }
  if (!event.pressed) return { mods: mods, entries: entries }
  var text = chordText(mods, keyLabel(event.keycode))
  var last = entries.length > 0 ? entries[entries.length - 1] : null
  if (last && last.text === text) {
    entries[entries.length - 1] = { text: text, count: last.count + 1 }
  } else {
    entries.push({ text: text, count: 1 })
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
  }
  return { mods: mods, entries: entries }
}

function entryLabel(entry) {
  return entry.count > 1 ? entry.text + " ×" + entry.count : entry.text
}

if (typeof module !== "undefined") {
  module.exports = {
    REGISTER_LUA: REGISTER_LUA,
    UNREGISTER_LUA: UNREGISTER_LUA,
    PROBE_LUA: PROBE_LUA,
    MAX_ENTRIES: MAX_ENTRIES,
    replCommand: replCommand,
    parseEvent: parseEvent,
    evdevCode: evdevCode,
    isModifier: isModifier,
    modifierName: modifierName,
    keyLabel: keyLabel,
    emptyState: emptyState,
    chordText: chordText,
    applyEvent: applyEvent,
    entryLabel: entryLabel
  }
}
