// Static QML checks for the failure class qmllint does not catch at exit
// level: a JS model qualifier used without its import (a runtime
// ReferenceError), and a root-level property set twice (a scene-load
// failure that takes the whole panel down).
//
// This file is generic and byte-identical across every omarchy plugin repo
// (source of truth: omarchy-nexus). It discovers .qml files itself and
// detects root level by brace depth, so indent style does not matter.
// Update it in nexus and copy it verbatim; never fork it per repo.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const SKIP_DIRS = new Set(['.git', 'test-output', 'node_modules'])
// QML's own *Model types may legitimately appear before a dot one day;
// they are not JS imports.
const QML_BUILTINS = new Set(['ListModel', 'ObjectModel', 'DelegateModel', 'ItemSelectionModel'])

function qmlFilesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (SKIP_DIRS.has(entry.name)) return []
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return qmlFilesBelow(absolute)
    return entry.name.endsWith('.qml') ? [absolute] : []
  })
}

// Depth per line, ignoring braces inside strings and comments. Good enough
// for machine-formatted QML; a parser would be overkill for two checks.
function annotateDepth(source) {
  const rows = []
  let depth = 0
  let inBlockComment = false
  for (const line of source.split('\n')) {
    rows.push({ line, depth })
    let inString = null
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inBlockComment) {
        if (ch === '*' && line[i + 1] === '/') { inBlockComment = false; i++ }
        continue
      }
      if (inString) {
        if (ch === '\\') i++
        else if (ch === inString) inString = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') inString = ch
      else if (ch === '/' && line[i + 1] === '/') break
      else if (ch === '/' && line[i + 1] === '*') { inBlockComment = true; i++ }
      else if (ch === '{') depth++
      else if (ch === '}') depth--
    }
  }
  return rows
}

const files = qmlFilesBelow(root)
assert.ok(files.length >= 1, 'the QML inventory is discoverable')

for (const absolute of files) {
  const relative = path.relative(root, absolute)
  const source = fs.readFileSync(absolute, 'utf8')

  const imports = new Set()
  for (const match of source.matchAll(/import\s+"[^"]+"\s+as\s+(\w+)/g)) {
    imports.add(match[1])
  }
  for (const match of source.matchAll(/\b([A-Z]\w*(?:Model|Rows))\b(?=\.)/g)) {
    if (QML_BUILTINS.has(match[1])) continue
    assert.ok(imports.has(match[1]),
      `${relative} uses ${match[1]} without importing it`)
  }

  const rootLevelKeys = {}
  const rows = annotateDepth(source)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].depth !== 1) continue
    const trimmed = rows[i].line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    const match = trimmed.match(/^([a-zA-Z_][\w.]*)\s*:/)
    if (!match) continue
    const key = match[1]
    if (key === 'anchors') continue
    assert.equal(rootLevelKeys[key], undefined,
      `${relative} sets root-level '${key}' twice (lines ${rootLevelKeys[key]} and ${i + 1})`)
    rootLevelKeys[key] = i + 1
  }
}

console.log('ok - qml static checks (' + files.length + ' files)')
