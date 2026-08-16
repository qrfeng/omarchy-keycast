const assert = require('node:assert/strict')
const model = require('../model/KeycastModel.js')

// ---- lua + event parsing ----------------------------------------------------

assert.ok(model.REGISTER_LUA.indexOf('hl.on("input.keyboard.key"') !== -1)
assert.ok(model.REGISTER_LUA.indexOf('hl.dsp.event("keycast,') !== -1)
assert.ok(model.UNREGISTER_LUA.indexOf(':remove()') !== -1)
assert.deepEqual(model.replCommand('x'), ['hyprctl', 'repl', 'x'])

assert.deepEqual(model.parseEvent('keycast,38,1'), { keycode: 38, pressed: true })
assert.deepEqual(model.parseEvent('keycast,38,0'), { keycode: 38, pressed: false })
assert.equal(model.parseEvent('keycast,evil,1'), null)
assert.equal(model.parseEvent('keycast,38'), null)
assert.equal(model.parseEvent('otherthing,38,1'), null)
assert.equal(model.parseEvent('keycast,5,1'), null, 'xkb keycodes are always > 8')

// ---- labels -----------------------------------------------------------------

assert.equal(model.evdevCode(38), 30)
assert.equal(model.keyLabel(38), 'A')
assert.equal(model.keyLabel(9), 'Esc')
assert.equal(model.keyLabel(65), 'Space')
assert.equal(model.keyLabel(36), '⏎')
assert.equal(model.keyLabel(255), '#247', 'unknown codes degrade to numbers')
assert.equal(model.isModifier(133), true, 'xkb 133 = evdev 125 = Super_L')
assert.equal(model.modifierName(133), 'Super')
assert.equal(model.isModifier(38), false)

// ---- reducer ----------------------------------------------------------------

let state = model.emptyState()
state = model.applyEvent(state, { keycode: 133, pressed: true })   // Super down
assert.deepEqual(state.mods, { Super: true })
assert.equal(state.entries.length, 0, 'bare modifiers show nothing')

state = model.applyEvent(state, { keycode: 36, pressed: true })    // Enter
assert.equal(state.entries[0].text, 'Super + ⏎')

state = model.applyEvent(state, { keycode: 133, pressed: false })  // Super up
state = model.applyEvent(state, { keycode: 38, pressed: true })    // a
state = model.applyEvent(state, { keycode: 38, pressed: false })
state = model.applyEvent(state, { keycode: 38, pressed: true })
assert.equal(state.entries.length, 2)
assert.equal(state.entries[1].text, 'A')
assert.equal(state.entries[1].count, 2, 'repeats coalesce')
assert.equal(model.entryLabel(state.entries[1]), 'A ×2')

// Shift shows for named keys, not for letters (the label itself implies it).
let shifted = model.applyEvent(model.emptyState(), { keycode: 50, pressed: true }) // Shift down
shifted = model.applyEvent(shifted, { keycode: 38, pressed: true })
assert.equal(shifted.entries[0].text, 'A')
shifted = model.applyEvent(shifted, { keycode: 36, pressed: true })
assert.equal(shifted.entries[1].text, 'Shift + ⏎')

// Cap at MAX_ENTRIES.
let full = model.emptyState()
for (let i = 0; i < 10; i++) {
  full = model.applyEvent(full, { keycode: 17 + i, pressed: true })
}
assert.equal(full.entries.length, model.MAX_ENTRIES)

console.log('ok - keycast model')
