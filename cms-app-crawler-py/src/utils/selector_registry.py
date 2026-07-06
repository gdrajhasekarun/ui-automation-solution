import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_fallback_map: dict[str, list[str]] = {}
_loaded = False

_REGISTRY_PATH = Path(__file__).parent.parent.parent / "resources" / "pom_registry.json"


def _load(registry_path: Path = _REGISTRY_PATH) -> None:
    global _fallback_map, _loaded
    if _loaded:
        return
    if not registry_path.exists():
        logger.warning("SelectorRegistry: registry not found at %s — no fallbacks available", registry_path)
        _loaded = True
        return
    with open(registry_path, encoding="utf-8") as f:
        entries: list[dict] = json.load(f)
    _fallback_map.clear()
    for entry in entries:
        key = entry.get("selectorKey")
        if not key:
            continue
        _fallback_map[key] = entry.get("selectorFallbacks", [])
    _loaded = True
    logger.info("SelectorRegistry loaded: %d entries from %s", len(_fallback_map), registry_path)


class SelectorRegistry:
    @staticmethod
    def load(registry_path: str | None = None) -> None:
        path = Path(registry_path) if registry_path else _REGISTRY_PATH
        _load(path)

    @staticmethod
    def get_fallbacks(selector_key: str) -> list[str]:
        if not _loaded:
            _load()
        return _fallback_map.get(selector_key, [])

    @staticmethod
    def reset() -> None:
        global _fallback_map, _loaded
        _fallback_map = {}
        _loaded = False
