import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import "model/KeycastModel.js" as KeycastModel

// Keycast engine + HUD. While enabled, a one-line Lua handler registered
// through `hyprctl repl` re-emits every key event as a socket2 custom
// event; this service reduces the stream into chord chips rendered on a
// non-interactive overlay above the focused monitor. Disabled = the
// handler is removed and the compositor does zero per-key work. Nothing
// is written to disk — keystrokes exist only in memory and on screen.
Item {
  id: root

  property var shell: null

  property bool enabled: false
  property var hudState: KeycastModel.emptyState()
  property string lastError: ""

  readonly property var hudScreen: {
    var screens = Quickshell.screens || []
    var focused = Hyprland.focusedMonitor
    for (var i = 0; i < screens.length; i++) {
      var monitor = Hyprland.monitorFor(screens[i])
      if (focused && monitor === focused) return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  function run(proc) {
    proc.exitSeen = false
    proc.running = true
  }

  function setEnabled(value) {
    var next = value === true
    if (next === enabled) return
    lastError = ""
    enabled = next
    hudState = KeycastModel.emptyState()
    replProcess.command = KeycastModel.replCommand(
      next ? KeycastModel.REGISTER_LUA : KeycastModel.UNREGISTER_LUA)
    run(replProcess)
  }

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      if (event.name === "custom") {
        if (!root.enabled) return
        var parsed = KeycastModel.parseEvent(event.data)
        if (parsed === null) return
        root.hudState = KeycastModel.applyEvent(root.hudState, parsed)
        if (parsed.pressed) idleTimer.restart()
      } else if (event.name === "configreloaded" && root.enabled) {
        // The repl Lua VM was reinitialized; the subscription is gone.
        replProcess.command = KeycastModel.replCommand(KeycastModel.REGISTER_LUA)
        root.run(replProcess)
      }
    }
  }

  Timer {
    id: idleTimer
    interval: 3000
    onTriggered: root.hudState = KeycastModel.emptyState()
  }

  Process {
    id: replProcess
    property bool exitSeen: false
    command: ["hyprctl", "repl", ""]
    onRunningChanged: if (!running && !exitSeen) {
      root.lastError = "hyprctl could not be started"
      root.enabled = false
    }
    onExited: function (exitCode) {
      exitSeen = true
      if (exitCode !== 0) {
        root.lastError = "keycast handler registration failed"
        root.enabled = false
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
        "error": root.lastError
      })
    }
  }

  PanelWindow {
    visible: root.enabled && root.hudState.entries.length > 0
    screen: root.hudScreen
    color: "transparent"
    WlrLayershell.namespace: "keycast"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    implicitWidth: chipRow.implicitWidth + Style.space(24)
    implicitHeight: chipRow.implicitHeight + Style.space(16)

    anchors {
      bottom: true
    }

    margins {
      bottom: Style.space(48)
    }

    mask: Region {
    }

    Rectangle {
      anchors.fill: parent
      radius: Style.cornerRadius
      color: Qt.rgba(Color.menu.background.r, Color.menu.background.g, Color.menu.background.b, 0.88)
      border.color: Qt.rgba(Color.accent.r, Color.accent.g, Color.accent.b, 0.5)
      border.width: 1
    }

    Row {
      id: chipRow

      anchors.centerIn: parent
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
  }
}
