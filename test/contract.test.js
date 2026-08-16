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
assert.doesNotMatch(service, /FileView|setText/, 'keystrokes are never written to disk')

// The HUD surface never takes input or focus.
assert.match(service, /WlrKeyboardFocus\.None/, 'the HUD never takes keyboard focus')
assert.match(service, /mask: Region \{/, 'the HUD is click-through')
assert.match(service, /WlrLayer\.Overlay/)

// Off = off: the handler is removed and events are ignored.
assert.match(model, /KEYCAST_SUB:remove\(\)/, 'disable removes the compositor-side handler')
assert.match(service, /if \(!root\.enabled\) return/, 'stray events are dropped while off')

// Process hygiene.
assert.doesNotMatch(service + widget, /execDetached|bash -c|sh -c/, 'no shell command strings')
assert.equal((service.match(/\bProcess\s*\{/g) || []).length, 1,
  'one process: the repl register/unregister call')
assert.equal((widget.match(/\bProcess\s*\{/g) || []).length, 0, 'the widget spawns nothing')
assert.match(service, /property bool exitSeen/, 'the repl process detects unstartable hyprctl')

console.log('ok - keycast contract')
