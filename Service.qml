import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "model/KeycastModel.js" as KeycastModel

// Keycast engine + HUD. While enabled, a one-line Lua handler registered
// through `hyprctl repl` re-emits every key event as a socket2 custom
// event; this service reduces the stream into a bottom-left overlay.
//
// Two things live in that overlay:
//   * hold-to-hint — hold Super/Ctrl/Alt/Shift for a beat and the panel lists
//     the chords that modifier can fire, straight from the keybinds manager's
//     own model, so the wording matches what the user configured;
//   * chord echo — a completed shortcut prints once, annotated with what it
//     does. Ordinary typing prints nothing.
//
// The overlay never takes focus or input. Nothing is written to disk: held
// modifiers live in memory and disappear with the process.
Item {
  id: root

  property var shell: null

  // Loaded by the shell at login, so the hints are there from the first
  // keystroke of the session. The bar widget toggles it off for screencasts.
  property bool enabled: true
  // "shortcuts" (default) = only chords with Super/Ctrl/Alt, plus function and
  // multimedia keys; "all" = every keystroke. See KeycastModel.shouldRecord.
  property string scope: KeycastModel.SCOPE_SHORTCUTS
  property var hudState: KeycastModel.emptyState()
  property var bindings: []
  property var hints: KeycastModel.emptyHints()
  property bool hintVisible: false
  // A modifier must be held this long before the list appears, so that
  // Shift+letter typing never flashes it.
  property int hintDelayMs: 450
  property int maxHintRows: KeycastModel.MAX_HINT_ROWS
  property string lastError: ""
  property int registerTries: 0

  readonly property var hudScreen: {
    var screens = Quickshell.screens || []
    var focused = Hyprland.focusedMonitor
    for (var i = 0; i < screens.length; i++) {
      var monitor = Hyprland.monitorFor(screens[i])
      if (focused && monitor === focused) return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  readonly property string newestDesc: {
    var entries = hudState.entries
    if (entries.length === 0) return ""
    return entries[entries.length - 1].desc || ""
  }

  // Last event seen, for diagnosing the hint path without reading the screen.
  property string lastEvent: ""

  function run(proc) {
    proc.exitSeen = false
    proc.running = true
  }

  function registerHandler() {
    replProcess.intent = "register"
    replProcess.command = KeycastModel.replCommand(KeycastModel.REGISTER_LUA)
    run(replProcess)
  }

  function unregisterHandler() {
    replProcess.intent = "unregister"
    replProcess.command = KeycastModel.replCommand(KeycastModel.UNREGISTER_LUA)
    run(replProcess)
  }

  // The catalogue is the keybinds manager's model, so a rebound key needs no
  // restart here: `omarchy-keybinds set` + a config reload refreshes it.
  function loadBindings() {
    run(bindingsProcess)
  }

  function setEnabled(value) {
    var next = value === true
    if (next === enabled) return
    lastError = ""
    enabled = next
    hudState = KeycastModel.emptyState()
    holdTimer.stop()
    hintVisible = false
    hints = KeycastModel.emptyHints()
    if (next) {
      registerTries = 0
      registerHandler()
      if (bindings.length === 0) loadBindings()
    } else {
      unregisterHandler()
    }
  }

  // Only the two known scopes; anything else falls back to chords-only.
  function setScope(value) {
    scope = value === KeycastModel.SCOPE_ALL
      ? KeycastModel.SCOPE_ALL
      : KeycastModel.SCOPE_SHORTCUTS
    hudState = KeycastModel.emptyState()
    return scope
  }

  // How often each chord has actually been pressed, persisted across sessions
  // so the hint list can lead with the shortcuts you really use. Keyed by the
  // displayed chord text, which the catalogue and the keystroke echo share.
  property var usage: ({})
  property bool usageDirty: false

  function applyUsage(text) {
    usage = KeycastModel.parseUsage(text)
    if (hintVisible) refreshHints()
  }

  function countChord(chord) {
    if (chord === "") return
    var counts = {}
    var key
    for (key in usage) counts[key] = usage[key]
    counts[chord] = (counts[chord] || 0) + 1
    usage = counts
    usageDirty = true
    usageTimer.restart()
  }

  function saveUsage() {
    usageDirty = false
    usageFile.setText(`${JSON.stringify(KeycastModel.topUsage(usage), null, 2)}\n`)
  }

  // Recompute the list from the modifiers held right now. Called when a
  // modifier comes or goes while the list is up, so adding Ctrl visibly
  // narrows what Super offered.
  function refreshHints() {
    if (!enabled || !KeycastModel.hasHintMod(hudState.mods)) {
      hintVisible = false
      hints = KeycastModel.emptyHints()
      return
    }
    hints = KeycastModel.hintRows(bindings, hudState.mods, maxHintRows, usage)
    measureHints(hints.rows)
    hintVisible = hints.rows.length > 0
  }

  // Called with the collector's buffer once `omarchy-keybinds list` finishes.
  function applyCatalogue(text) {
    var rows = KeycastModel.parseBindings(text)
    if (rows.length === 0) {
      lastError = KeycastModel.bindingsError() || "no hintable keybinds"
      return
    }
    bindings = rows
    lastError = ""
    if (hintVisible) refreshHints()
  }

  FileView {
    id: usageFile

    path: `${Quickshell.env("HOME")}/.local/state/omarchy/keycast-usage.json`
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyUsage(usageFile.text())
    onLoadFailed: function (error) {
      // First run: no counters yet, and the plugin creates the file on the
      // first saved press. Anything else is a real problem worth reporting.
      if (error === FileViewError.FileNotFound) root.applyUsage("{}")
      else root.lastError = "usage counters unreadable"
    }
  }

  // Coalesce bursts of keystrokes into one write.
  Timer {
    id: usageTimer

    interval: 5000
    onTriggered: root.saveUsage()
  }

  Component.onCompleted: {
    registerHandler()
    loadBindings()
  }

  Component.onDestruction: if (root.usageDirty) root.saveUsage()

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      if (event.name === "custom") {
        if (!root.enabled) return
        staleTimer.restart()
        var parsed = KeycastModel.parseEvent(event.data)
        if (parsed === null) return
        var modifier = KeycastModel.isModifier(parsed.keycode)
        root.lastEvent = parsed.keycode + (parsed.pressed ? " down" : " up")
          + (modifier ? " mod" : " key")
        var shown = root.hudState.entries
        var fresh = KeycastModel.applyEvent(root.hudState, parsed, root.scope,
          root.bindings)
        root.hudState = fresh
        // A press that reached the HUD is a chord you really used. Only chords
        // with a modifier are counted, so ordinary typing is never tallied even
        // in the every-keystroke scope.
        if (!modifier && parsed.pressed && fresh.entries.length > 0
          && Object.keys(fresh.mods).length > 0) {
          var newest = fresh.entries[fresh.entries.length - 1]
          var before = shown.length > 0 ? shown[shown.length - 1] : null
          if (before === null || before.text !== newest.text
            || newest.count > before.count) root.countChord(newest.text)
        }
        if (modifier) {
          if (root.hintVisible) root.refreshHints()
          else if (parsed.pressed) holdTimer.restart()
          else root.refreshHints()
        } else if (parsed.pressed) {
          // The chord fired: show what it did instead of the standing list.
          holdTimer.stop()
          root.hintVisible = false
          idleTimer.restart()
        }
      } else if (event.name === "configreloaded" && root.enabled) {
        // The repl Lua VM was reinitialized; the subscription is gone.
        root.registerHandler()
        root.loadBindings()
      }
    }
  }

  // A modifier key-up can be missed (restart mid-press, a grabbed keyboard),
  // which would leave the hint panel standing. If no key moved for a while,
  // nothing is held.
  // Widths of the hint table's first two columns, measured with the actual
  // fonts so every row lines up exactly.
  property real chordColWidth: 0
  property real groupColWidth: 0

  FontMetrics {
    id: chordMetrics

    font.family: Style.font.family
    font.pixelSize: Style.font.caption
    font.bold: true
  }

  FontMetrics {
    id: groupMetrics

    font.family: Style.font.family
    font.pixelSize: Style.font.caption
  }

  function measureHints(rows) {
    var chord = 0
    var group = 0
    var list = rows || []
    var i
    for (i = 0; i < list.length; i++) {
      chord = Math.max(chord, chordMetrics.advanceWidth(list[i].chord))
      group = Math.max(group, groupMetrics.advanceWidth(list[i].group))
    }
    root.chordColWidth = chord
    root.groupColWidth = group
  }

  Timer {
    id: staleTimer
    interval: 5000
    onTriggered: {
      root.hudState = KeycastModel.emptyState()
      root.hints = KeycastModel.emptyHints()
      root.hintVisible = false
    }
  }

  Timer {
    id: idleTimer
    interval: 3000
    onTriggered: root.hudState = KeycastModel.emptyState()
  }

  Timer {
    id: holdTimer
    interval: root.hintDelayMs
    onTriggered: root.refreshHints()
  }

  // The compositor socket may come up after the shell at login, so a failed
  // registration is retried instead of latching the service off.
  Timer {
    id: retryTimer
    interval: 1000
    onTriggered: {
      if (!root.enabled || root.registerTries >= 10) return
      root.registerTries += 1
      root.registerHandler()
    }
  }

  Process {
    id: replProcess
    property bool exitSeen: false
    property string intent: "register"
    command: ["hyprctl", "repl", ""]
    onRunningChanged: if (!running && !exitSeen) {
      root.lastError = "hyprctl could not be started"
      if (intent === "register") retryTimer.restart()
      else root.enabled = false
    }
    onExited: function (exitCode) {
      exitSeen = true
      if (exitCode === 0) {
        if (intent === "register") {
          root.registerTries = 0
          root.lastError = ""
        }
        return
      }
      root.lastError = "keycast handler registration failed"
      if (intent === "register") retryTimer.restart()
      else root.enabled = false
    }
  }

  // The keybind catalogue. `omarchy-keybinds list` is the manager's own model,
  // so curated Chinese labels and per-layer chords come free instead of being
  // re-derived here.
  Process {
    id: bindingsProcess
    property bool exitSeen: false
    command: ["omarchy-keybinds", "list"]
    stdout: StdioCollector {

      // The catalogue is one large JSON line; wait for the whole stream.
      waitForEnd: true
      onStreamFinished: root.applyCatalogue(text)
    }
    onRunningChanged: if (!running && !exitSeen) {
      root.lastError = "omarchy-keybinds could not be started"
    }
    onExited: function (exitCode) {
      exitSeen = true
      if (exitCode !== 0 && root.bindings.length === 0) {
        root.lastError = "keybind catalogue unavailable"
      }
    }
  }

  IpcHandler {
    target: "community.keycast"

    function toggle(): string {
      root.setEnabled(!root.enabled)
      return root.enabled ? "on" : "off"
    }

    function enable(): string {
      root.setEnabled(true)
      return "on"
    }

    function disable(): string {
      root.setEnabled(false)
      return "off"
    }

    function status(): string {
      return JSON.stringify({
        "enabled": root.enabled,
        "entries": root.hudState.entries.length,
        "scope": root.scope,
        "bindings": root.bindings.length,
        "held": root.hudState.mods,
        "hintVisible": root.hintVisible,
        "cols": `${root.chordColWidth.toFixed(0)}x${root.groupColWidth.toFixed(0)}`,
        "lastEvent": root.lastEvent,
        "hints": root.hintVisible ? root.hints.rows.length : 0,
        "uses": Object.keys(root.usage).length,
        "error": root.lastError
      })
    }

    // The hint list as it stands, for checking what a held modifier offers
    // without having to read the screen.
    function hints(): string {
      return JSON.stringify(root.hintVisible ? root.hints : KeycastModel.emptyHints())
    }

    // Diagnostic: run the hint lookup for an arbitrary held-modifier set, so
    // a broken catalogue and a dead hold timer can be told apart.
    function probe(held: string): string {
      var mods = {}
      try {
        mods = JSON.parse(held)
      } catch (error) {
        return "bad json: " + error
      }
      return JSON.stringify(KeycastModel.hintRows(root.bindings, mods,
        root.maxHintRows, root.usage))
    }

    // The usage counters behind the ordering, busiest first.
    function usage(): string {
      return JSON.stringify(KeycastModel.topUsage(root.usage, 20))
    }

    // Forget the counters: the hint list goes back to key order.
    function resetUsage(): string {
      root.usage = {}
      root.usageDirty = false
      root.saveUsage()
      if (root.hintVisible) root.refreshHints()
      return "usage cleared"
    }

    // Re-read the keybind catalogue after editing bindings by hand.
    function refresh(): string {
      root.loadBindings()
      return "refreshing"
    }

    // Display scope: chords only (default), or every keystroke.
    function scopeShortcuts(): string {
      return root.setScope(KeycastModel.SCOPE_SHORTCUTS)
    }

    function scopeAll(): string {
      return root.setScope(KeycastModel.SCOPE_ALL)
    }

    function toggleScope(): string {
      return root.setScope(root.scope === KeycastModel.SCOPE_ALL
        ? KeycastModel.SCOPE_SHORTCUTS
        : KeycastModel.SCOPE_ALL)
    }
  }

  PanelWindow {
    visible: root.enabled && (root.hudState.entries.length > 0 || root.hintVisible)
    screen: root.hudScreen
    color: "transparent"
    WlrLayershell.namespace: "keycast"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    implicitWidth: hudColumn.implicitWidth + Style.space(24)
    implicitHeight: hudColumn.implicitHeight + Style.space(16)

    // Bottom-left corner: the bottom-centre band belongs to OmaDock (layer
    // namespace `omadock`), so a centred HUD lands on top of it.
    anchors {
      bottom: true
      left: true
    }

    margins {
      bottom: Style.space(48)
      left: Style.space(24)
    }

    mask: Region {
    }

    Rectangle {
      anchors.fill: parent
      radius: Style.cornerRadius
      color: Qt.rgba(Color.menu.background.r, Color.menu.background.g, Color.menu.background.b, 0.92)
      border.color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.5)
      border.width: 1
    }

    Column {
      id: hudColumn

      anchors.centerIn: parent
      spacing: Style.space(6)

      Row {
        id: chipRow

        visible: root.hudState.entries.length > 0
        spacing: Style.space(8)

        Repeater {
          model: root.hudState.entries

          Rectangle {
            required property var modelData
            required property int index

            readonly property bool newest: index === root.hudState.entries.length - 1

            implicitWidth: chipText.implicitWidth + Style.space(16)
            implicitHeight: chipText.implicitHeight + Style.space(8)
            radius: Style.space(4)
            color: newest
              ? Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.25)
              : Qt.rgba(Color.menu.text.r, Color.menu.text.g, Color.menu.text.b, 0.08)

            Text {
              id: chipText

              anchors.centerIn: parent
              text: KeycastModel.entryLabel(parent.modelData)
              color: parent.newest ? Color.accent : Color.menu.text
              font.family: Style.font.family
              font.pixelSize: Style.font.subtitle
              font.bold: parent.newest
            }
          }
        }
      }

      // What the chord that just fired does, when the catalogue knows it.
      Text {
        visible: root.newestDesc !== ""
        text: root.newestDesc
        color: Color.menu.text
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
      }

      Text {
        visible: root.hintVisible
        text: root.hints.label + " 时可用的快捷键"
          + (root.hints.total > root.hints.rows.length
            ? "（显示前 " + root.hints.rows.length + " / 共 " + root.hints.total + " 条）"
            : "（" + root.hints.total + " 条）")
        color: Color.accent
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        font.bold: true
      }

      // Fixed-width cells per row: the chord, the group and the description
      // share one Row, so a taller CJK line box can never make the columns
      // drift apart the way two side-by-side Columns did.
      Column {
        visible: root.hintVisible

        spacing: Style.space(3)

        Repeater {
          model: root.hintVisible ? root.hints.rows : []

          delegate: Row {
            required property var modelData

            spacing: Style.space(14)

            Text {
              // Never narrower than its own content, even if the measurement
              // ran before the font metrics settled.
              width: Math.max(root.chordColWidth, implicitWidth)
              text: parent.modelData.chord
              color: Color.accent
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              font.bold: true
            }

            Text {
              width: Math.max(root.groupColWidth, implicitWidth)
              text: parent.modelData.group
              color: Qt.rgba(Color.menu.text.r, Color.menu.text.g, Color.menu.text.b, 0.55)
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }

            Text {
              text: parent.modelData.desc
              color: Color.menu.text
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
            }
          }
        }
      }
    }
  }
}
