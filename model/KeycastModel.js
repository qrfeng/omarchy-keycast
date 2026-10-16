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
  99: "PrtSc", 127: "Menu",
  // Multimedia / hardware keys. Hyprland binds all of these, and without a
  // label each one would degrade to "#<code>" on the HUD.
  113: "静音", 114: "音量 -", 115: "音量 +", 116: "电源", 140: "计算器",
  161: "弹出", 163: "下一曲", 164: "播放/暂停", 165: "上一曲", 166: "停止", 207: "播放",
  224: "亮度 -", 225: "亮度 +", 226: "媒体", 228: "键盘灯", 229: "键盘灯 -",
  230: "键盘灯 +", 248: "麦克风静音", 530: "触控板切换", 531: "触控板开",
  532: "触控板关"
}

// evdev modifier codes.
var MODIFIERS = {
  29: "Ctrl", 97: "Ctrl",
  42: "Shift", 54: "Shift",
  56: "Alt", 100: "Alt",
  125: "Super", 126: "Super"
}

// Display scope. "shortcuts" (default) only puts a chord on screen when it
// looks like a shortcut; "all" is the upstream behaviour of showing every
// single keystroke, which is noise when you are using keycast to learn
// bindings rather than recording a screencast.
var SCOPE_SHORTCUTS = "shortcuts"
var SCOPE_ALL = "all"

// Super/Ctrl/Alt turn a key into a shortcut. Shift is deliberately absent:
// Shift + a printable key is just typing that key's shifted symbol.
var SHORTCUT_MODS = { Super: true, Ctrl: true, Alt: true }

// Keys that are a shortcut on their own, no modifier required: the function
// row, screen capture, and the multimedia/hardware keys above.
var STANDALONE_CODES = {
  59: 1, 60: 1, 61: 1, 62: 1, 63: 1, 64: 1, 65: 1, 66: 1, 67: 1, 68: 1,
  87: 1, 88: 1, 99: 1, 113: 1, 114: 1, 115: 1, 116: 1, 140: 1, 161: 1,
  163: 1, 164: 1, 165: 1, 207: 1, 224: 1, 225: 1, 226: 1, 228: 1, 229: 1,
  230: 1, 248: 1, 530: 1, 531: 1, 532: 1
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

function hasShortcutMod(mods) {
  for (var name in mods) if (SHORTCUT_MODS[name]) return true
  return false
}

function isStandaloneShortcut(xkbKeycode) {
  return STANDALONE_CODES[evdevCode(xkbKeycode)] === 1
}

function isShortcut(mods, xkbKeycode) {
  return hasShortcutMod(mods) || isStandaloneShortcut(xkbKeycode)
}

// The one scope decision the reducer makes. Bare modifier presses still
// update the held-mod set (see applyEvent) so the chord of the key that
// follows is labelled correctly.
function shouldRecord(scope, mods, xkbKeycode) {
  return scope === SCOPE_ALL || isShortcut(mods, xkbKeycode)
}

function scopeLabel(scope) {
  return scope === SCOPE_ALL ? "全部按键" : "仅快捷键"
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
// append a chord entry (repeats coalesce into ×N) when the scope allows it.
// Entries cap at MAX_ENTRIES, oldest dropped. `bindings` is optional: when the
// caller passes the hint catalogue, a chord that is actually bound also
// carries what it does.
function applyEvent(state, event, scope, bindings) {
  var mods = {}
  for (var key in state.mods) mods[key] = state.mods[key]
  var entries = state.entries.slice()
  if (isModifier(event.keycode)) {
    if (event.pressed) mods[modifierName(event.keycode)] = true
    else delete mods[modifierName(event.keycode)]
    return { mods: mods, entries: entries }
  }
  if (!event.pressed) return { mods: mods, entries: entries }
  if (!shouldRecord(scope, mods, event.keycode)) return { mods: mods, entries: entries }
  var text = chordText(mods, keyLabel(event.keycode))
  var desc = describeChord(bindings, mods, keyLabel(event.keycode))
  var last = entries.length > 0 ? entries[entries.length - 1] : null
  if (last && last.text === text) {
    entries[entries.length - 1] = { text: text, count: last.count + 1, desc: last.desc || desc }
  } else {
    entries.push({ text: text, count: 1, desc: desc })
    if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
  }
  return { mods: mods, entries: entries }
}

function entryLabel(entry) {
  return entry.count > 1 ? entry.text + " ×" + entry.count : entry.text
}

// ---------------------------------------------------------------------------
// Hold-to-hint. While a modifier is physically held down, the HUD lists the
// chords that modifier can fire instead of echoing keystrokes. The catalogue
// is `omarchy-keybinds list` (the keybinds manager's own model), so the hint
// text is the same curated Chinese label the manager window shows.
// ---------------------------------------------------------------------------

// Any of the four modifier keys triggers a hint after the hold delay. Shift is
// included on purpose, but the delay is what keeps ordinary Shift+letter
// typing from flashing the list.
var HINT_MODS = { Super: true, Ctrl: true, Alt: true, Shift: true }
var MOD_ORDER = ["Super", "Ctrl", "Alt", "Shift"]
var MAX_HINT_ROWS = 12

var MOD_NAME_ALIAS = {
  SUPER: "Super", WIN: "Super", META: "Super", MOD4: "Super",
  CTRL: "Ctrl", CONTROL: "Ctrl",
  ALT: "Alt", MOD1: "Alt",
  SHIFT: "Shift"
}

// QWERTY layers, so a keysym name or a bare character resolves to the evdev
// code the key events carry and a hint row agrees with an echoed chord.
var LAYER_DIGITS = "1234567890-="
var LAYER_TOP = "qwertyuiop[]"
var LAYER_HOME = "asdfghjkl;'"
var LAYER_BOTTOM = "zxcvbnm,./"

// Keysym names seen in the bind model that are not a single character. A name
// missing here keeps its raw token as the label: the hint is still readable,
// it just never pairs up with an echoed keystroke.
var KEYNAME_EVDEV = {
  RETURN: 28, ENTER: 28, KPENTER: 96, KP_ENTER: 96,
  TAB: 15, ESC: 1, ESCAPE: 1, BACKSPACE: 14,
  DELETE: 111, DEL: 111, INSERT: 110, INS: 110,
  HOME: 102, END: 107, PAGEUP: 104, PAGE_UP: 104, PAGEDOWN: 109, PAGE_DOWN: 109,
  UP: 103, DOWN: 108, LEFT: 105, RIGHT: 106, SPACE: 57,
  PRINT: 99, PRTSC: 99, MENU: 127, COMPOSE: 127,
  CAPSLOCK: 58, CAPS_LOCK: 58,
  MINUS: 12, EQUAL: 13, PLUS: 13, GRAVE: 41, BACKQUOTE: 41,
  LEFTBRACKET: 26, BRACKETLEFT: 26, RIGHTBRACKET: 27, BRACKETRIGHT: 27,
  BACKSLASH: 43, SEMICOLON: 39, APOSTROPHE: 40, QUOTE: 40,
  COMMA: 51, PERIOD: 52, SLASH: 53
}

// The media/hardware keysyms the bind model spells out. Codes checked against
// /usr/include/linux/input-event-codes.h; they land on evdev codes that
// EVDEV_LABELS already names, so a hint row and an echoed chord print the same
// thing instead of one of them printing "XF86AudioMute".
var XF86_EVDEV = {
  XF86AUDIOMUTE: 113,
  XF86AUDIOLOWERVOLUME: 114,
  XF86AUDIORAISEVOLUME: 115,
  XF86POWEROFF: 116,
  XF86CALCULATOR: 140,
  XF86EJECT: 161,
  XF86AUDIONEXT: 163,
  XF86AUDIOPAUSE: 164,
  XF86AUDIOPREV: 165,
  XF86AUDIOSTOP: 166,
  XF86AUDIOPLAY: 207,
  XF86MONBRIGHTNESSDOWN: 224,
  XF86MONBRIGHTNESSUP: 225,
  XF86AUDIO: 226,
  XF86KBDLIGHTONOFF: 228,
  XF86KBDBRIGHTNESSDOWN: 229,
  XF86KBDBRIGHTNESSUP: 230,
  XF86AUDIOMICMUTE: 248,
  XF86TOUCHPADTOGGLE: 530,
  XF86TOUCHPADON: 531,
  XF86TOUCHPADOFF: 532
}

// Chords whose tail is not a key at all.
var TOKEN_LABELS = {
  "MOUSE:272": "鼠标左键", "MOUSE:273": "鼠标右键", "MOUSE:274": "鼠标中键",
  "MOUSE_UP": "滚轮上", "MOUSE_DOWN": "滚轮下"
}

// Last catalogue parse failure, surfaced through the service's error field.
var bindingsParseError = ""

function charEvdev(ch) {
  var lower = String(ch).toLowerCase()
  var index = LAYER_DIGITS.indexOf(lower)
  if (index >= 0) return 2 + index
  index = LAYER_TOP.indexOf(lower)
  if (index >= 0) return 16 + index
  index = LAYER_HOME.indexOf(lower)
  if (index >= 0) return 30 + index
  index = LAYER_BOTTOM.indexOf(lower)
  if (index >= 0) return 44 + index
  if (lower === "`") return 41
  return null
}

// `code:<n>` in the bind model is an xkb keycode, same unit as the events.
function tokenEvdev(token) {
  var text = String(token === null || token === undefined ? "" : token).trim()
  var code = /^code:(\d+)$/.exec(text)
  var mapped
  if (text === "") return null
  if (code) return Number(code[1]) - 8
  if (text.length === 1) return charEvdev(text)
  mapped = KEYNAME_EVDEV[text.toUpperCase()]
  if (mapped === undefined) mapped = XF86_EVDEV[text.toUpperCase()]
  return mapped === undefined ? null : mapped
}

function tokenLabel(token) {
  var code = tokenEvdev(token)
  var text = String(token === null || token === undefined ? "" : token).trim()
  if (code !== null) return EVDEV_LABELS[code] || `#${code}`
  return TOKEN_LABELS[text.toUpperCase()] || text
}

// "SUPER + CTRL + TAB" -> { mods: {Super,Ctrl}, token: "TAB" }.
// Returns null for chords this feature cannot show, such as herdr's
// "PREFIX + Q" (two-step, no plain modifier) or a bare key.
function modsFromChord(text) {
  var parts = String(text === null || text === undefined ? "" : text)
    .split("+")
    .map(function (part) { return part.trim() })
    .filter(function (part) { return part !== "" })
  var mods = {}
  var name
  var i
  if (parts.length < 2) return null
  var token = parts.pop()
  for (i = 0; i < parts.length; i++) {
    name = MOD_NAME_ALIAS[parts[i].toUpperCase()]
    if (!name || !HINT_MODS[name]) return null
    mods[name] = true
  }
  return { mods: mods, token: token }
}

function modNames(mods) {
  var names = []
  var i
  for (i = 0; i < MOD_ORDER.length; i++) {
    if (mods[MOD_ORDER[i]]) names.push(MOD_ORDER[i])
  }
  return names
}

function modsKey(mods) {
  return modNames(mods).join("+")
}

function namesOfKey(key) {
  return key === "" ? [] : key.split("+")
}

function hasHintMod(mods) {
  return modNames(mods).length > 0
}

// A bind is relevant while held while it asks for every modifier held so far.
function bindCovers(bindKey, heldKey) {
  var held = namesOfKey(heldKey)
  var padded = `+${bindKey}+`
  var i
  for (i = 0; i < held.length; i++) {
    if (padded.indexOf(`+${held[i]}+`) < 0) return false
  }
  return true
}

function extraModCount(bindKey, heldKey) {
  var held = namesOfKey(heldKey)
  var need = namesOfKey(bindKey)
  var extra = 0
  var i
  for (i = 0; i < need.length; i++) {
    if (held.indexOf(need[i]) < 0) extra++
  }
  return extra
}

// Digits, then letters, then everything else: a held modifier should reveal a
// stable, scannable key order rather than catalog order.
function hintRank(bind) {
  var token = bind.token
  if (/^\d$/.test(token)) return `0${token}`
  if (/^[A-Z]$/.test(token)) return `1${token}`
  return `2${token}`
}

function compareHints(a, b) {
  var ra = hintRank(a)
  var rb = hintRank(b)
  if (ra < rb) return -1
  if (ra > rb) return 1
  return 0
}

function hintChord(bind) {
  return `${namesOfKey(bind.mods).join(" + ")} + ${bind.label}`
}

// ---------------------------------------------------------------------------
// Usage counts. A chord that fires often is the one worth seeing first, so the
// service keeps `{ "Super + J": 42, ... }` in the user state dir and hint
// ordering follows it. Keyed by the displayed chord text, which both the
// catalogue and the echoed keystroke produce with the same function.
// ---------------------------------------------------------------------------

var MAX_USAGE_ENTRIES = 300

function parseUsage(text) {
  var counts = {}
  var data
  var key
  try {
    data = JSON.parse(String(text))
  } catch (error) {
    return counts
  }
  if (data === null || typeof data !== "object") return counts
  for (key in data) {
    if (typeof data[key] === "number" && data[key] > 0) counts[key] = data[key]
  }
  return counts
}

function usageOf(usage, chord) {
  var counts = usage || {}
  var count = counts[chord]
  return typeof count === "number" ? count : 0
}

// Busiest first; chords never used (or used equally) keep the key order.
function compareByUsage(a, b) {
  if (b.uses !== a.uses) return b.uses - a.uses
  return compareHints(a.bind, b.bind)
}

// Trim a count map to the chords that matter before writing it to disk.
function topUsage(usage, limit) {
  var counts = usage || {}
  var keys = Object.keys(counts)
  var max = limit > 0 ? limit : MAX_USAGE_ENTRIES
  var out = {}
  var kept = 0
  var i
  keys.sort(function (a, b) {
    return counts[b] - counts[a]
  })
  for (i = 0; i < keys.length && kept < max; i++) {
    out[keys[i]] = counts[keys[i]]
    kept++
  }
  return out
}

// Turn the manager's JSON into the compact chord catalogue the HUD filters.
// Rows without a plain-modifier chord (bare keys, herdr's PREFIX chords, lid
// switches) and rows without any description are dropped.
function parseBindings(text) {
  var data
  var list
  var rows = []
  var seen = {}
  var i
  var row
  var parsed
  var key
  var desc
  var bind
  var id
  try {
    data = JSON.parse(String(text))
  } catch (error) {
    bindingsParseError = String(error)
    return []
  }
  bindingsParseError = ""
  list = (data && data.active) || []
  for (i = 0; i < list.length; i++) {
    row = list[i] || {}
    parsed = modsFromChord(row.key)
    if (parsed === null) continue
    key = modsKey(parsed.mods)
    if (key === "") continue
    // The manager lists unbound chords too ("已解绑：原本是 …") so you can
    // re-bind them; a hint must not offer a chord that fires nothing.
    if (row.status === "disabled") continue
    desc = row.description_zh || row.description || ""
    if (desc === "") continue
    bind = {
      mods: key,
      token: String(parsed.token).toUpperCase(),
      label: tokenLabel(parsed.token),
      desc: desc,
      cat: row.category_zh || ""
    }
    id = `${hintChord(bind)}\u0000${desc}`
    if (seen[id]) continue
    seen[id] = true
    rows.push(bind)
  }
  return rows
}

function emptyHints() {
  return { held: "", label: "", rows: [], exact: 0, total: 0 }
}

// Exact-modifier chords first (those are the ones the held keys can fire
// right now), then chords that still need another modifier, fewest extra
// first, so adding Ctrl while Super is held visibly narrows the list.
function hintRows(bindings, mods, maxRows, usage) {
  var held = modsKey(mods)
  if (held === "") return emptyHints()
  var exact = []
  var deeper = []
  var list = bindings || []
  var counts = usage || {}
  var limit = maxRows > 0 ? maxRows : MAX_HINT_ROWS
  var rows = []
  var bind
  var item
  var chord
  var i
  var j
  for (i = 0; i < list.length; i++) {
    bind = list[i]
    if (!bindCovers(bind.mods, held)) continue
    chord = hintChord(bind)
    item = {
      bind: bind,
      chord: chord,
      uses: usageOf(counts, chord)
    }
    if (extraModCount(bind.mods, held) === 0) exact.push(item)
    else deeper.push(item)
  }
  exact.sort(compareByUsage)
  deeper.sort(function (a, b) {
    var diff = extraModCount(a.bind.mods, held) - extraModCount(b.bind.mods, held)
    return diff !== 0 ? diff : compareByUsage(a, b)
  })
  var matched = exact.concat(deeper)
  for (j = 0; j < matched.length && rows.length < limit; j++) {
    rows.push({
      chord: matched[j].chord,
      group: matched[j].bind.cat || "自定义",
      desc: matched[j].bind.desc,
      uses: matched[j].uses
    })
  }
  return {
    held: held,
    label: held === "" ? "" : `按住 ${namesOfKey(held).join(" + ")}`,
    rows: rows,
    exact: exact.length,
    total: matched.length
  }
}

function bindingsError() {
  return bindingsParseError
}

// What the chord that was just pressed does, for the echo chip. Matched on
// the exact modifier set plus the same label the HUD prints, so a miss is
// silent instead of wrong.
function describeChord(bindings, mods, label) {
  var key = modsKey(mods)
  var list = bindings || []
  var i
  for (i = 0; i < list.length; i++) {
    if (list[i].mods === key && list[i].label === label) return list[i].desc
  }
  return ""
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
    SCOPE_SHORTCUTS: SCOPE_SHORTCUTS,
    SCOPE_ALL: SCOPE_ALL,
    hasShortcutMod: hasShortcutMod,
    isStandaloneShortcut: isStandaloneShortcut,
    isShortcut: isShortcut,
    shouldRecord: shouldRecord,
    scopeLabel: scopeLabel,
    HINT_MODS: HINT_MODS,
    MAX_HINT_ROWS: MAX_HINT_ROWS,
    modsFromChord: modsFromChord,
    modsKey: modsKey,
    hasHintMod: hasHintMod,
    tokenLabel: tokenLabel,
    tokenEvdev: tokenEvdev,
    parseBindings: parseBindings,
    bindingsError: bindingsError,
    hintRows: hintRows,
  parseUsage: parseUsage,
  usageOf: usageOf,
  topUsage: topUsage,
  MAX_USAGE_ENTRIES: MAX_USAGE_ENTRIES,
    emptyHints: emptyHints,
    describeChord: describeChord,
    emptyState: emptyState,
    chordText: chordText,
    applyEvent: applyEvent,
    entryLabel: entryLabel
  }
}
