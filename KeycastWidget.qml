import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// Keycast toggle chip: lit while chords are being displayed. All
// logic lives in the always-loaded service; the widget is a thin view.
BarWidget {
  id: root
  moduleName: "community.keycast"

  property var engine: null
  property int resolveAttempts: 0

  readonly property bool keycastOn: engine ? engine.enabled === true : false
  readonly property bool showAll: engine ? engine.scope === "all" : false

  readonly property string scopeText: showAll ? "全部按键" : "仅快捷键"

  implicitWidth: engine ? button.implicitWidth : 0
  implicitHeight: engine ? button.implicitHeight : 0
  visible: engine !== null

  function resolveEngine() {
    var host = bar && bar.shell && typeof bar.shell.serviceFor === "function" ? bar.shell : null
    if (host) engine = host.serviceFor("community.keycast")
  }

  Component.onCompleted: resolveEngine()

  Timer {
    interval: 1000
    repeat: true
    running: root.engine === null && root.resolveAttempts < 30
    onTriggered: {
      root.resolveAttempts++
      root.resolveEngine()
    }
  }

  BarIconButton {
    id: button
    bar: root.bar
    text: "󰌌"
    active: root.keycastOn
    tooltipText: root.keycastOn
      ? "快捷键 HUD：已开（" + root.scopeText + "）· 按住 Super/Ctrl/Alt/Shift 会列出可用快捷键 · 点击关闭"
      : "快捷键 HUD：已关 · 点击开启（按住 Super/Ctrl/Alt/Shift 看可用快捷键），密码也会上屏"
    onPressed: if (root.engine) root.engine.setEnabled(!root.keycastOn)
  }
}
