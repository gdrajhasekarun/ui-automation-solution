"""
plan_eval.py
Deterministic quality evaluation of a generated plan.
No LLM needed — scores purely from graph + registry data.
"""
from datetime import datetime, timezone


def _grade(score: float) -> str:
    if score >= 90: return "A"
    if score >= 80: return "B"
    if score >= 70: return "C"
    if score >= 60: return "D"
    return "F"


def _build_method_set(registry: list[dict]) -> set[str]:
    return {r.get("methodName", "") for r in registry if r.get("methodName")}


def _registry_has_params(method_name: str, registry: list[dict]) -> bool:
    for r in registry:
        if r.get("methodName") == method_name:
            return bool(r.get("parameterNames"))
    return False


def _edge_class_sequence(graph: dict, pageref_to_class: dict[str, str]) -> list[tuple[str, str]]:
    """Return (from_class, to_class) pairs in edge order, deduped."""
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        node_map = {n.get("nodeId", str(i)): n for i, n in enumerate(raw_nodes)}
    else:
        node_map = raw_nodes

    def _cls(nid: str) -> str:
        node = node_map.get(nid, {})
        pr = node.get("pageRef", "")
        return pageref_to_class.get(pr, pr)

    seen: set = set()
    pairs: list[tuple[str, str]] = []
    for e in graph.get("edges", []):
        from_id = e.get("from") or e.get("fromNodeId", "")
        to_id   = e.get("to")   or e.get("toNodeId", "")
        key = (from_id, to_id)
        if key not in seen:
            seen.add(key)
            pairs.append((_cls(from_id), _cls(to_id)))
    return pairs


def _required_click_methods(graph: dict, pageref_to_class: dict[str, str],
                              sk_to_method: dict[str, dict]) -> list[str]:
    """Return the expected CLICK method sigs derived from edge triggers."""
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        node_map = {n.get("nodeId", str(i)): n for i, n in enumerate(raw_nodes)}
    else:
        node_map = raw_nodes

    def _cls(nid: str) -> str:
        node = node_map.get(nid, {})
        pr = node.get("pageRef", "")
        return pageref_to_class.get(pr, pr)

    def _node_els(node: dict) -> list:
        els = node.get("elements") or node.get("ownElements") or []
        return els if isinstance(els, list) else []

    seen_pairs: set = set()
    clicks: list[str] = []
    for e in graph.get("edges", []):
        from_id = e.get("from") or e.get("fromNodeId", "")
        to_id   = e.get("to")   or e.get("toNodeId", "")
        if (from_id, to_id) in seen_pairs:
            continue
        seen_pairs.add((from_id, to_id))

        from_node = node_map.get(from_id, {})
        from_cls  = _cls(from_id)
        trigger   = e.get("trigger", {})
        trig_eid  = trigger.get("elementId", "") if isinstance(trigger, dict) else ""
        trig_name = (trigger.get("elementName") if isinstance(trigger, dict) else None) or e.get("label", "")

        method_name = ""
        for el in _node_els(from_node):
            sk = el.get("_selector") or el.get("selectorKey") or el.get("interactionKey") or ""
            if sk and (el.get("id") == trig_eid or el.get("elementId") == trig_eid):
                m = sk_to_method.get(sk, {})
                method_name = m.get("methodName", "")
                break

        sig = f"{from_cls}.{method_name}" if method_name else f"{from_cls}.click_{trig_name}"
        clicks.append(sig)
    return clicks


def eval_plan(
    planner_output: dict,
    graph: dict,
    registry: list[dict],
    pageref_to_class: dict[str, str] | None = None,
    sk_to_method: dict[str, dict] | None = None,
) -> dict:
    steps    = planner_output.get("steps", [])
    flags: list[str] = []

    # ── 1. Method validity ───────────────────────────────────────────────────
    method_set = _build_method_set(registry)
    valid_count = 0
    for s in steps:
        mname = s.get("methodName", "")
        if mname in method_set:
            valid_count += 1
        else:
            flags.append(f"WARN: step '{s.get('humanReadable', mname)}' uses unknown method '{mname}'")
    mv_score = (valid_count / len(steps) * 100) if steps else 100.0
    mv_notes = f"{valid_count}/{len(steps)} methods found in registry"

    # ── 2. Path coverage ─────────────────────────────────────────────────────
    edge_pairs = _edge_class_sequence(graph, pageref_to_class or {})
    step_classes = [s.get("pageClass", "") for s in steps if s.get("pageClass")]
    # Check how many expected from_classes appear in the step sequence
    if edge_pairs:
        expected_from = [p[0] for p in edge_pairs]
        matched = sum(1 for ec in expected_from if ec in step_classes)
        pc_score = (matched / len(expected_from)) * 100
        pc_notes = f"{matched}/{len(expected_from)} navigation page classes covered"
    else:
        pc_score = 100.0
        pc_notes = "no edges in graph"

    # ── 3. Parameter completeness ─────────────────────────────────────────────
    param_required = [s for s in steps if _registry_has_params(s.get("methodName", ""), registry)]
    param_correct  = sum(1 for s in param_required if s.get("hasParameter"))
    param_score    = (param_correct / len(param_required) * 100) if param_required else 100.0
    param_notes    = f"{param_correct}/{len(param_required)} fill steps have hasParameter=true"
    if param_correct < len(param_required):
        flags.append(f"WARN: {len(param_required) - param_correct} fill step(s) missing hasParameter=true")

    # ── 4. Step completeness (navigation trigger coverage) ────────────────────
    required_clicks = _required_click_methods(graph, pageref_to_class or {}, sk_to_method or {})
    if required_clicks:
        covered = 0
        for req in required_clicks:
            req_cls, _, req_mth = req.partition(".")
            if any(s.get("pageClass") == req_cls and s.get("methodName") == req_mth for s in steps):
                covered += 1
        sc_score = (covered / len(required_clicks)) * 100
        sc_notes = f"{covered}/{len(required_clicks)} navigation triggers covered"
        if covered < len(required_clicks):
            flags.append(f"WARN: missing navigation triggers in generated steps")
    else:
        sc_score = 100.0
        sc_notes = "no navigation triggers to check"

    if not steps:
        flags.append("ERROR: plan has no steps")

    overall = round(
        mv_score * 0.35 + pc_score * 0.25 + param_score * 0.20 + sc_score * 0.20, 1
    )

    return {
        "score": overall,
        "grade": _grade(overall),
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "dimensions": {
            "methodValidity":    {"score": round(mv_score, 1),    "notes": mv_notes},
            "pathCoverage":      {"score": round(pc_score, 1),    "notes": pc_notes},
            "paramCompleteness": {"score": round(param_score, 1), "notes": param_notes},
            "stepCompleteness":  {"score": round(sc_score, 1),    "notes": sc_notes},
        },
        "flags": flags,
    }
