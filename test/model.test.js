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

// ---- reducer (scope = all) --------------------------------------------------

const ALL = model.SCOPE_ALL

let state = model.emptyState()
state = model.applyEvent(state, { keycode: 133, pressed: true }, ALL)   // Super down
assert.deepEqual(state.mods, { Super: true })
assert.equal(state.entries.length, 0, 'bare modifiers show nothing')

state = model.applyEvent(state, { keycode: 36, pressed: true }, ALL)    // Enter
assert.equal(state.entries[0].text, 'Super + ⏎')

state = model.applyEvent(state, { keycode: 133, pressed: false }, ALL)  // Super up
state = model.applyEvent(state, { keycode: 38, pressed: true }, ALL)    // a
state = model.applyEvent(state, { keycode: 38, pressed: false }, ALL)
state = model.applyEvent(state, { keycode: 38, pressed: true }, ALL)
assert.equal(state.entries.length, 2)
assert.equal(state.entries[1].text, 'A')
assert.equal(state.entries[1].count, 2, 'repeats coalesce')
assert.equal(model.entryLabel(state.entries[1]), 'A ×2')

// Shift shows for named keys, not for letters (the label itself implies it).
let shifted = model.applyEvent(model.emptyState(), { keycode: 50, pressed: true }, ALL) // Shift down
shifted = model.applyEvent(shifted, { keycode: 38, pressed: true }, ALL)
assert.equal(shifted.entries[0].text, 'A')
shifted = model.applyEvent(shifted, { keycode: 36, pressed: true }, ALL)
assert.equal(shifted.entries[1].text, 'Shift + ⏎')

// Cap at MAX_ENTRIES.
let full = model.emptyState()
for (let i = 0; i < 10; i++) {
  full = model.applyEvent(full, { keycode: 17 + i, pressed: true }, ALL)
}
assert.equal(full.entries.length, model.MAX_ENTRIES)

// ---- display scope: chords only (the default) -------------------------------

assert.equal(model.SCOPE_SHORTCUTS, 'shortcuts')
assert.equal(model.hasShortcutMod({ Super: true }), true)
assert.equal(model.hasShortcutMod({ Shift: true }), false, 'Shift + a key is just typing')
assert.equal(model.isStandaloneShortcut(67), true, 'xkb 67 = F5')
assert.equal(model.isStandaloneShortcut(38), false)
assert.equal(model.keyLabel(123), '音量 +', 'multimedia keys are labelled, not #<code>')
assert.equal(model.scopeLabel(undefined), '仅快捷键')
assert.equal(model.scopeLabel(model.SCOPE_ALL), '全部按键')

// Typing stays off screen, and a dropped event still tracks modifiers.
let typing = model.applyEvent(model.emptyState(), { keycode: 38, pressed: true })
typing = model.applyEvent(typing, { keycode: 36, pressed: true })
assert.equal(typing.entries.length, 0, 'typing shows nothing by default')
typing = model.applyEvent(typing, { keycode: 50, pressed: true })        // Shift down
typing = model.applyEvent(typing, { keycode: 36, pressed: true })        // Enter
assert.equal(typing.entries.length, 0, 'Shift + Enter is typing, not a chord')
assert.deepEqual(typing.mods, { Shift: true }, 'dropped events still track modifiers')

// Chords and standalone function/multimedia keys show with no scope argument.
let chords = model.applyEvent(model.emptyState(), { keycode: 133, pressed: true }) // Super
chords = model.applyEvent(chords, { keycode: 38, pressed: true })
assert.equal(chords.entries[0].text, 'Super + A')
chords = model.applyEvent(chords, { keycode: 133, pressed: false })
chords = model.applyEvent(chords, { keycode: 37, pressed: true })        // Ctrl_L down
chords = model.applyEvent(chords, { keycode: 65, pressed: true })        // Space
assert.equal(chords.entries[1].text, 'Ctrl + Space')
chords = model.applyEvent(chords, { keycode: 37, pressed: false })
chords = model.applyEvent(chords, { keycode: 71, pressed: true })        // F5 (xkb 71 = evdev 63)
assert.equal(chords.entries[2].text, 'F5')
chords = model.applyEvent(chords, { keycode: 123, pressed: true })       // VolumeUp
assert.equal(chords.entries[3].text, '音量 +')

// ---- hold-to-hint catalogue -------------------------------------------------

assert.equal(model.modsFromChord('SUPER + CTRL + TAB').token, 'TAB')
assert.deepEqual(model.modsFromChord('SUPER + CTRL + TAB').mods, { Super: true, Ctrl: true })
assert.equal(model.modsFromChord('F5'), null, 'no modifier: nothing to hint')
assert.equal(model.modsFromChord('PREFIX + Q'), null, 'herdr prefix chords are not plain-modifier chords')
assert.equal(model.modsFromChord(''), null)

assert.equal(model.modsKey({ Shift: true, Super: true }), 'Super+Shift', 'canonical modifier order')
assert.equal(model.hasHintMod({ Shift: true }), true, 'Shift can be held for hints; the delay guards typing')
assert.equal(model.hasHintMod({}), false)

assert.equal(model.tokenEvdev('J'), 36)
assert.equal(model.tokenEvdev('code:10'), 2, 'code:<n> is an xkb keycode')
assert.equal(model.tokenLabel('RETURN'), '⏎')
assert.equal(model.tokenLabel('PAGE_UP'), 'PgUp')
assert.equal(model.tokenLabel('XF86AudioMute'), '静音')
assert.equal(model.tokenLabel('mouse:273'), '鼠标右键')
assert.equal(model.tokenLabel('code:10'), '1')

const FIXTURE = JSON.stringify({
  active: [
    { key: 'SUPER + J', description_zh: '关闭窗口', category_zh: '窗口' },
    { key: 'SUPER + SHIFT + J', description_zh: '向下拆分', category_zh: '窗口' },
    { key: 'SUPER + CTRL + TAB', description_zh: '上一个工作区', category_zh: '工作区' },
    { key: 'SUPER + 1', description_zh: '工作区 1', category_zh: '工作区' },
    { key: 'SUPER + mouse:272', description_zh: '拖动窗口', category_zh: '窗口' },
    { key: 'F5', description_zh: '刷新', category_zh: '系统' },
    { key: 'PREFIX + Q', description_zh: 'herdr 退出前缀', category_zh: '终端' },
    { key: 'SUPER + J', description_zh: '关闭窗口', category_zh: '窗口' },
    { key: 'SUPER + K', description_zh: '已解绑：原本是 启动器', status: 'disabled', category_zh: '系统' }
  ]
})
const catalogue = model.parseBindings(FIXTURE)
assert.equal(catalogue.length, 5,
  'bare keys, prefix chords, unbound rows and duplicates are dropped')
assert.equal(catalogue.some(bind => bind.label === 'K'), false, 'an unbound chord is never offered')
assert.deepEqual(model.parseBindings('not json'), [])
assert.notEqual(model.bindingsError(), '', 'a bad catalogue reports why')
assert.deepEqual(model.parseBindings('{"active":[]}'), [])

// Holding Super: exact chords first (digits, then letters, then the rest),
// then chords that still need another modifier.
let hints = model.hintRows(catalogue, { Super: true })
assert.equal(hints.label, '按住 Super')
assert.equal(hints.exact, 3)
assert.equal(hints.total, 5)
assert.deepEqual(hints.rows.map(row => row.chord), [
  'Super + 1', 'Super + J', 'Super + 鼠标左键',
  'Super + Shift + J', 'Super + Ctrl + ⇥'
], 'exact chords by key order first, then chords needing one more modifier')
assert.equal(model.hintRows(catalogue, { Super: true }, 2).rows.length, 2, 'row cap')

// Each row carries the manager's category, so the HUD can show a group column
// between the chord and its description.
assert.deepEqual(hints.rows.map(row => row.group),
  ['工作区', '窗口', '窗口', '窗口', '工作区'], 'rows carry their group')
assert.equal(model.hintRows(model.parseBindings(JSON.stringify({
  active: [{ key: 'SUPER + O', description_zh: '没有分类', status: 'custom' }]
})), { Super: true }).rows[0].group, '自定义', 'a category-less bind is still labelled')

// ---- usage ranking ---------------------------------------------------------

// The chords you press most lead the list; untouched ones keep key order.
const USED = { 'Super + J': 42, 'Super + 1': 7 }
let ranked = model.hintRows(catalogue, { Super: true }, 5, USED)
assert.deepEqual(ranked.rows.map(row => row.chord),
  ['Super + J', 'Super + 1', 'Super + 鼠标左键', 'Super + Shift + J', 'Super + Ctrl + ⇥'],
  'busiest chords first, then the untouched key order')
assert.equal(ranked.rows[0].uses, 42, 'a row reports its own usage')

// Usage orders the "needs another modifier" tail too, but never ahead of the
// chords the held keys can actually fire.
let deeper = model.hintRows(catalogue, { Super: true }, 5, { 'Super + Ctrl + ⇥': 99 })
assert.deepEqual(deeper.rows.map(row => row.chord).slice(0, 3),
  ['Super + 1', 'Super + J', 'Super + 鼠标左键'], 'exact chords still come first')
assert.deepEqual(deeper.rows.map(row => row.chord).slice(3),
  ['Super + Ctrl + ⇥', 'Super + Shift + J'],
  'inside the deeper group the busiest chord jumps the key order')

assert.deepEqual(model.parseUsage('nope'), {}, 'a corrupt counter file is not fatal')
assert.deepEqual(model.parseUsage('{"Super + J": 3, "x": "no", "y": -1}'),
  { 'Super + J': 3 }, 'only positive counts survive')
assert.equal(model.usageOf({}, 'Super + J'), 0, 'never-used chords count as zero')
assert.deepEqual(model.topUsage({ a: 1, b: 9, c: 5 }, 2), { b: 9, c: 5 },
  'the persisted file stays capped and drops the cold entries')

// Adding Ctrl while Super is held narrows the list to what both can fire.
let narrowed = model.hintRows(catalogue, { Super: true, Ctrl: true })
assert.equal(narrowed.exact, 1)
assert.equal(narrowed.rows[0].chord, 'Super + Ctrl + ⇥')
assert.equal(narrowed.rows[0].desc, '上一个工作区')

let nothing = model.hintRows([], { Super: true })
assert.deepEqual([nothing.rows.length, nothing.total], [0, 0], 'an empty catalogue hints nothing')
assert.equal(nothing.label, '按住 Super', 'it still says what is held')
assert.deepEqual(model.hintRows(catalogue, {}), model.emptyHints(),
  'nothing held: no hints, plain typing never raises the list')

// ---- the echo chip carries what the chord does ------------------------------

let annotated = model.applyEvent(model.emptyState(), { keycode: 133, pressed: true },
  model.SCOPE_SHORTCUTS, catalogue)
annotated = model.applyEvent(annotated, { keycode: 38, pressed: true },
  model.SCOPE_SHORTCUTS, catalogue)
assert.equal(annotated.entries[0].text, 'Super + A')
assert.equal(annotated.entries[0].desc, '', 'an unbound chord claims nothing')
annotated = model.applyEvent(annotated, { keycode: 44, pressed: true },
  model.SCOPE_SHORTCUTS, catalogue)
assert.equal(annotated.entries[1].text, 'Super + J')
assert.equal(annotated.entries[1].desc, '关闭窗口')
assert.equal(model.describeChord(catalogue, { Super: true }, 'J'), '关闭窗口')
assert.equal(model.describeChord(catalogue, { Super: true }, 'Z'), '')
assert.equal(model.describeChord(null, { Super: true }, 'J'), '')

console.log('ok - keycast model')
