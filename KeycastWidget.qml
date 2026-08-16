import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// Keycast toggle chip: lit while keystrokes are being displayed. All
// logic lives in the always-loaded service; the widget is a thin view.
BarWidget {
  id: root
  moduleName: "community.keycast"

  property var engine: null
  property int resolveAttempts: 0

  readonly property bool keycastOn: engine ? engine.enabled === true : false

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
      ? "Keycast on — keystrokes show on screen (mind passwords!) · click to stop"
      : "Keycast off — click to show keystrokes for screencasts"
    onPressed: if (root.engine) root.engine.setEnabled(!root.keycastOn)
  }
}
