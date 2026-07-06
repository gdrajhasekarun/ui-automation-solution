'use strict';

const fs = require('fs');
const path = require('path');

let _fallbackMap = new Map();
let _loaded = false;

const REGISTRY_PATH = path.join(__dirname, '../../resources/pom_registry.json');

function load(registryPath = REGISTRY_PATH) {
  if (_loaded) return;
  if (!fs.existsSync(registryPath)) {
    console.warn(`SelectorRegistry: registry not found at ${registryPath} — no fallbacks available`);
    _loaded = true;
    return;
  }
  const entries = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  _fallbackMap.clear();
  for (const entry of entries) {
    const key = entry.selectorKey;
    if (!key) continue;
    _fallbackMap.set(key, entry.selectorFallbacks || []);
  }
  _loaded = true;
  console.info(`SelectorRegistry loaded: ${_fallbackMap.size} entries from ${registryPath}`);
}

function getFallbacks(selectorKey) {
  if (!_loaded) load();
  return _fallbackMap.get(selectorKey) || [];
}

function reset() {
  _fallbackMap.clear();
  _loaded = false;
}

module.exports = { SelectorRegistry: { load, getFallbacks, reset } };
