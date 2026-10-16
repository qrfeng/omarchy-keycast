const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

const manifest = JSON.parse(read('manifest.json'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.id, 'community.keycast')
assert.deepEqual(manifest.kinds, ['service', 'bar-widget'])
assert.equal(manifest.keepLoaded, true)
assert.equal(manifest.license, 'MIT')
assert.match(read('LICENSE'), /MIT License/)

const service = read('Service.qml')
const widget = read('KeycastWidget.qml')
const model = read('model/KeycastModel.js')

// The event pipeline: Lua bus handler -> socket2 custom event ->
// rawEvent -> pure reducer. No evdev, no polling, no logging.
assert.match(model, /hl\.on\("input\.keyboard\.key"/, 'the source is the 0.56 Lua key event bus')
assert.match(model, /hl\.dsp\.event\("keycast,/, 'the bridge is a socket2 custom event')
assert.match(service, /KeycastModel\.parseEvent/, 'events parse defensively')
assert.match(service, /KeycastModel\.applyEvent/, 'the HUD state is a pure reducer')
assert.match(service, /"configreloaded"/, 're-registers after config reload drops the Lua VM')
assert.doesNotMatch(service + widget + model, /\/dev\/input|libinput/,
  'never reads input devices directly')
// Persistence is deliberately narrow: no keystrokes at all, only how often a
// chord that actually fired has been used, in the user's state dir, capped.
assert.equal((service.match(/^\s*path:/gm) || []).length, 1,
  'the usage counter file is the only thing the plugin writes')
assert.match(service, /\.local\/state\/omarchy\/keycast-usage\.json/,
  'counters live in the state dir, and are named for what they hold')
assert.match(model, /topUsage/, 'the counter file is capped, never an unbounded log')
assert.doesNotMatch(service, /setText\([^)]*(parsed|event\.data|lastEvent)/,
  'raw keystrokes are never written to disk')
assert.match(service, /Object\.keys\(fresh\.mods\)\.length > 0/,
  'only chords with a modifier are tallied, never ordinary typing')

// The HUD surface never takes input or focus.
assert.match(service, /WlrKeyboardFocus\.None/, 'the HUD never takes keyboard focus')
assert.match(service, /mask: Region \{/, 'the HUD is click-through')
assert.match(service, /WlrLayer\.Overlay/)

// Off = off: the handler is removed and events are ignored.
assert.match(model, /KEYCAST_SUB:remove\(\)/, 'disable removes the compositor-side handler')
assert.match(service, /if \(!root\.enabled\) return/, 'stray events are dropped while off')

// Process hygiene. Two spawns, both argv arrays: the compositor-side handler
// registration, and reading the keybinds manager's model for the hint list.
assert.doesNotMatch(service + widget, /execDetached|bash -c|sh -c/, 'no shell command strings')
assert.equal((service.match(/\bProcess\s*\{/g) || []).length, 2,
  'two processes: the repl register call and the keybind catalogue')
assert.match(service, /"omarchy-keybinds", "list"/, 'hints reuse the keybinds manager model instead of a second parser')
assert.match(service, /KeycastModel\.parseBindings/, 'the catalogue is parsed before it is trusted')
assert.match(service, /hintDelayMs/, 'hints wait for a real hold, so typing never flashes a list')
assert.match(service, /delegate: Row \{/, 'each hint is one Row, so its three cells can never drift apart')
assert.match(service, /root\.chordColWidth/, 'the chord column has one measured width for every row')
assert.match(service, /modelData\.group/, 'the hint table shows the bind category between chord and description')
assert.match(model, /HINT_MODS/, 'only Super/Ctrl/Alt/Shift can raise the hint list')
assert.equal((widget.match(/\bProcess\s*\{/g) || []).length, 0, 'the widget spawns nothing')
assert.match(service, /property bool exitSeen/, 'the repl process detects unstartable hyprctl')

console.log('ok - keycast contract')
