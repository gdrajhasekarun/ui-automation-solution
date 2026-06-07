import hashlib
import json
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger("crawl-service.graph")


def _node_id(url: str) -> str:
    return "node_" + hashlib.md5(url.encode()).hexdigest()[:8]


_BAD_TITLES = {"error page", "access denied", "page", "untitled", "403", "404", "500", ""}


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


def build_graph(crawl_raw_path: str, app_id: str) -> dict:
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
        elements = page.get("elements", [])
        nodes[nid] = {
            "nodeId":            nid,
            "url":               url,
            "title":             title,
            "type":              "Page",
            "elements":          elements,
            "assertableElements": _select_assertable(elements),
        }

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

    logger.info(f"Graph built: {len(nodes)} nodes, {len(edges)} edges → {graph_path}")
    return graph
