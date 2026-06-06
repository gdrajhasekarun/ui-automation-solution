import json
import os
import hashlib
import logging
from datetime import datetime, timezone

logger = logging.getLogger("crawl-service.graph")


def _node_id(url: str) -> str:
    return "node_" + hashlib.md5(url.encode()).hexdigest()[:8]


def _to_pascal(title: str) -> str:
    return "".join(w.capitalize() for w in title.replace("-", " ").replace("_", " ").split() if w)


def build_graph(crawl_raw_path: str, app_id: str) -> dict:
    with open(crawl_raw_path) as f:
        raw = json.load(f)

    nodes = {}
    edges = []

    for page in raw:
        url = page.get("url", "")
        if not url:
            continue
        nid = _node_id(url)
        title = page.get("title") or _to_pascal(url.split("/")[-1] or "Home")
        elements = page.get("elements", [])

        assertable = []
        for el in elements:
            if el.get("role") in {"heading", "text", "img", "link"} or el.get("name"):
                assertable.append(el.get("selectorKey", el.get("name", "")))
            if len(assertable) >= 3:
                break

        if nid not in nodes:
            nodes[nid] = {
                "nodeId": nid,
                "url": url,
                "title": title,
                "type": "page",
                "elements": elements,
                "assertableElements": assertable
            }

        for t in page.get("transitions", []):
            target_url = t.get("toUrl")
            if not target_url:
                continue
            to_nid = _node_id(target_url)
            edge_id = f"edge_{nid}_{to_nid}_{hashlib.md5(t.get('selectorKey','').encode()).hexdigest()[:6]}"
            edges.append({
                "edgeId": edge_id,
                "fromNodeId": nid,
                "toNodeId": to_nid,
                "selectorKey": t.get("selectorKey", ""),
                "actionType": t.get("actionType", "click"),
                "label": t.get("label", "")
            })

    graph = {
        "meta": {
            "appId": app_id,
            "crawledAt": datetime.now(timezone.utc).isoformat(),
            "totalNodes": len(nodes),
            "totalEdges": len(edges)
        },
        "nodes": list(nodes.values()),
        "edges": edges
    }

    out_dir = os.path.dirname(crawl_raw_path)
    graph_path = os.path.join(out_dir, "graph.json")
    with open(graph_path, "w") as f:
        json.dump(graph, f, indent=2)

    logger.info(f"Graph built: {len(nodes)} nodes, {len(edges)} edges → {graph_path}")
    return graph
