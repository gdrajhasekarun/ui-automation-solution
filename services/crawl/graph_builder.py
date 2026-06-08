import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("crawl-service.graph")

# GUID pattern — matches CMS/framework internal IDs like fxb_460dba41-5ac6-465b-...
_GUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}', re.IGNORECASE)
# Internal hidden-field name patterns
_INTERNAL_FIELD_RE = re.compile(r'(FormSessionId|FormItemId|PageItemId|NavigationButtons|__VIEWSTATE|__EVENTVALIDATION|__RequestVerification)', re.IGNORECASE)


async def _notify(dashboard_url: str, app_id: str, message: str, level: str = "INFO"):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{dashboard_url}/api/events", json={
                "app_id": app_id, "stage": "GRAPH", "message": message, "level": level,
            })
    except Exception:
        pass


def _node_id(url: str) -> str:
    return "node_" + hashlib.md5(url.encode()).hexdigest()[:8]


_BAD_TITLES = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}

_NOISE_NAMES = {
    "", "click here", "here", "read more", "more", "learn more",
    "submit", "ok", "yes", "no", "cancel", "close", "open", "back", "next",
    "home", "menu", "navigation", "header", "footer", "nav", "search",
    "skip to content", "skip navigation",
    # Element type names used as fallback labels — not meaningful
    "input", "button", "select", "textarea", "a", "link", "text",
    "checkbox", "radio", "file", "password", "email", "tel", "number",
    "date", "time", "range", "color", "hidden",
}

_VALID_ACTION_TYPES = {"click", "fill", "select", "check", "hover"}


def _is_valid_element(el: dict) -> bool:
    """Return True only if the element has enough signal to be useful."""
    sk = (el.get("selectorKey") or "").strip()
    name = (el.get("name") or "").strip()
    action = (el.get("actionType") or "").strip().lower()

    # Must have a selector and a name
    if not sk or not name:
        return False
    # Selector must be non-trivial
    if sk in ("*", "body", "html", "#", "."):
        return False
    # Reject GUID-based IDs — internal CMS/framework hidden fields
    if _GUID_RE.search(sk) or _INTERNAL_FIELD_RE.search(sk):
        return False
    # Name must be meaningful
    if name.lower() in _NOISE_NAMES:
        return False
    # Name must not be a single character or pure digits
    if len(name) < 2 or name.isdigit():
        return False
    # Name must not be excessively long (likely scraped prose / concatenated option text)
    if len(name) > 60:
        return False
    if action and action not in _VALID_ACTION_TYPES:
        return False
    return True


def _element_fingerprints(el: dict) -> set[str]:
    """Return a set of 'type:value' strings covering all properties of this element."""
    fps: set[str] = set()
    primary = el.get("primary")
    if primary and primary.get("type") and primary.get("value"):
        fps.add(f"{primary['type']}:{primary['value']}")
    for prop in el.get("properties") or []:
        if prop.get("type") and prop.get("value"):
            fps.add(f"{prop['type']}:{prop['value']}")
    # Always include selectorKey as a fallback fingerprint
    sk = (el.get("selectorKey") or "").strip()
    if sk:
        fps.add(f"selectorKey:{sk}")
    return fps


def _dedup_elements(elements: list[dict]) -> list[dict]:
    """
    Deduplicate elements by property overlap — two elements are the same if any
    fingerprint (id, name, data-testid, placeholder, selectorKey) matches.
    When duplicates are found, keep the richer entry (more properties + longer name).
    """
    groups: list[tuple[set[str], dict]] = []  # (fingerprint_set, best_element)

    for el in elements:
        fps = _element_fingerprints(el)
        if not fps:
            continue
        # Find an existing group that shares at least one fingerprint
        matched_idx = None
        for i, (group_fps, _) in enumerate(groups):
            if group_fps & fps:
                matched_idx = i
                break

        if matched_idx is None:
            groups.append((fps, el))
        else:
            group_fps, existing = groups[matched_idx]
            # Merge fingerprint sets so future elements can match via any property
            group_fps |= fps
            # Keep the richer element: more properties wins, then longer name
            existing_score = len(existing.get("properties") or []) * 10 + len(existing.get("name") or "")
            new_score = len(el.get("properties") or []) * 10 + len(el.get("name") or "")
            groups[matched_idx] = (group_fps, el if new_score > existing_score else existing)

    return [el for _, el in groups]


def _filter_global_elements(nodes: dict) -> dict:
    """
    Remove elements that appear on ≥THRESHOLD fraction of all pages.
    These are header/footer/nav elements that belong to the site template,
    not the individual page — including them in every POM class is noise.
    """
    THRESHOLD = 0.6
    total = len(nodes)
    if total < 3:
        return nodes

    sk_count: dict[str, int] = {}
    for node in nodes.values():
        seen_in_page: set[str] = set()
        for el in node.get("elements", []):
            sk = el.get("selectorKey", "")
            if sk and sk not in seen_in_page:
                seen_in_page.add(sk)
                sk_count[sk] = sk_count.get(sk, 0) + 1

    global_sks = {sk for sk, cnt in sk_count.items() if cnt / total >= THRESHOLD}
    if global_sks:
        logger.info(f"Removing {len(global_sks)} global nav/template elements (appear on ≥{THRESHOLD:.0%} of pages)")

    for node in nodes.values():
        node["elements"] = [e for e in node.get("elements", []) if e.get("selectorKey", "") not in global_sks]
        node["assertableElements"] = [sk for sk in node.get("assertableElements", []) if sk not in global_sks]

    return nodes


def _to_pascal(s: str) -> str:
    return "".join(w.capitalize() for w in s.replace("-", " ").replace("_", " ").replace(".", " ").split() if w)


def _title_from_url(url: str) -> str:
    """Derive a readable page name from the URL path when the HTML title is useless."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    # Use subdomain if it's meaningful (e.g. member.molina → Member)
    subdomain = parsed.hostname.split(".")[0] if parsed.hostname else ""
    path_parts = [p for p in parsed.path.strip("/").split("/") if p and p not in ("en-us", "en-US", "common", "members", "pages", "aspx")]
    # Drop file extension from last segment
    if path_parts:
        last = path_parts[-1]
        if "." in last:
            path_parts[-1] = last.rsplit(".", 1)[0]
    label = " ".join(path_parts[-2:]) if path_parts else (subdomain if subdomain not in ("www", "") else "Home")
    return _to_pascal(label) or "Page"


def _edge_id(from_nid: str, to_nid: str, selector: str) -> str:
    key = f"{from_nid}_{to_nid}_{selector}"
    return "edge_" + hashlib.md5(key.encode()).hexdigest()[:8]


def _edge_exists(edges: list, from_nid: str, to_nid: str) -> bool:
    return any(e["fromNodeId"] == from_nid and e["toNodeId"] == to_nid for e in edges)


def _find_node_by_url(nodes: dict, url: str) -> dict | None:
    from urllib.parse import urlparse

    def norm(u: str) -> str:
        p = urlparse(u)
        return f"{p.scheme}://{p.netloc}{p.path}".rstrip("/")

    target = norm(url)
    for nid, node in nodes.items():
        if norm(node["url"]) == target:
            return node
    return None


def _select_assertable(elements: list) -> list[str]:
    chosen = []
    # Prefer data-testid
    for el in elements:
        sk = el.get("selectorKey", "")
        if sk.startswith("data-testid=") and len(chosen) < 3:
            chosen.append(sk)
    # Then headings / unique labels — skip generic nav
    generic = {"home", "menu", "navigation", "header", "footer", "nav", "search"}
    for el in elements:
        if len(chosen) >= 3:
            break
        sk = el.get("selectorKey", "")
        name = (el.get("name") or el.get("label") or "").lower()
        role = el.get("role", "")
        if sk in chosen:
            continue
        if role in {"heading"} or (role in {"link", "button"} and name and name not in generic):
            chosen.append(sk)
    return chosen[:3]


async def build_graph(crawl_raw_path: str, app_id: str, dashboard_url: str = "") -> dict:
    await _notify(dashboard_url, app_id, "Building site graph…")
    with open(crawl_raw_path) as f:
        raw = json.load(f)

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    # Build nodes first
    for page in raw:
        url = page.get("url", "")
        if not url:
            continue
        nid = _node_id(url)
        if nid in nodes:
            continue
        raw_title = (page.get("title") or "").strip()
        title = raw_title if raw_title.lower() not in _BAD_TITLES else _title_from_url(url)
        raw_elements = page.get("elements", [])
        elements = _dedup_elements([e for e in raw_elements if _is_valid_element(e)])
        nodes[nid] = {
            "nodeId":            nid,
            "url":               url,
            "title":             title,
            "type":              "Page",
            "elements":          elements,
            "assertableElements": _select_assertable(elements),
        }

    # Remove global nav/header/footer elements that appear on most pages
    nodes = _filter_global_elements(nodes)

    # Build edges
    for page in raw:
        url = page.get("url", "")
        if not url:
            continue
        from_nid = _node_id(url)

        # Primary edges — Playwright click-tracing
        for t in page.get("transitions", []):
            target_url = t.get("toUrl")
            if not target_url:
                continue
            to_nid = _node_id(target_url)
            edges.append({
                "edgeId":      _edge_id(from_nid, to_nid, t.get("selectorKey", "")),
                "fromNodeId":  from_nid,
                "toNodeId":    to_nid,
                "selectorKey": t.get("selectorKey", ""),
                "actionType":  t.get("actionType", "click"),
                "label":       t.get("label", ""),
                "isLoop":      from_nid == to_nid,
                "source":      "playwright",
            })

        # Secondary edges — Crawl4AI link graph (catch missed navigations)
        for link_href in page.get("c4ai_links", []):
            target_node = _find_node_by_url(nodes, link_href)
            if not target_node:
                continue
            to_nid = target_node["nodeId"]
            if _edge_exists(edges, from_nid, to_nid):
                continue
            edges.append({
                "edgeId":      _edge_id(from_nid, to_nid, "link"),
                "fromNodeId":  from_nid,
                "toNodeId":    to_nid,
                "selectorKey": None,
                "actionType":  "link",
                "label":       f"Link to {target_node['title']}",
                "isLoop":      from_nid == to_nid,
                "source":      "crawl4ai",
            })

    graph = {
        "meta": {
            "appId":       app_id,
            "crawledAt":   datetime.now(timezone.utc).isoformat(),
            "totalNodes":  len(nodes),
            "totalEdges":  len(edges),
        },
        "nodes": list(nodes.values()),
        "edges": edges,
    }

    out_dir = os.path.dirname(crawl_raw_path)
    graph_path = os.path.join(out_dir, "graph.json")
    with open(graph_path, "w") as f:
        json.dump(graph, f, indent=2)

    await _notify(dashboard_url, app_id,
        f"Graph complete — {len(nodes)} nodes, {len(edges)} edges", "SUCCESS")
    logger.info(f"Graph built: {len(nodes)} nodes, {len(edges)} edges → {graph_path}")
    return graph
