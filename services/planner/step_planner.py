import json
import logging
import os
from typing import TypedDict

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

logger = logging.getLogger("planner.step_planner")

SYSTEM_PROMPT = """You are a test automation expert. You are given a structured graph traversal of a web application and a set of test steps. Convert them into a Selenium Page Object Model method sequence.

Return ONLY a valid JSON object. No markdown. No explanation. No ```json fences.

{
  "testMethodName": "TC_001_ValidLogin",
  "startingClass": "LoginPage",
  "steps": [
    {
      "stepNumber": 1,
      "excelStepRef": 1,
      "pageClass": "LoginPage",
      "methodName": "enterEmail",
      "hasParameter": true,
      "parameterName": "enterEmail",
      "parameterType": "String",
      "isNavigation": false,
      "humanReadable": "Enter email address in the email field"
    }
  ],
  "parameters": [
    { "name": "enterEmail", "type": "String" },
    { "name": "enterPassword", "type": "String" }
  ],
  "finalAssertion": {
    "methodName": "assertTitle",
    "parameterName": "expectedTitle"
  },
  "confidence": 0.94,
  "reasoning": "one sentence"
}

Rules:
- The application launch is handled automatically by @BeforeMethod — do NOT emit a launch step.
- The graph is given as a list of edge blocks: [PageA → PageB] with an Intent line, FILL lines, and a CLICK line.
- Emit steps in EXACTLY the order the edge blocks appear in the graph traversal. Do NOT reorder steps to match test step labels.
- For each edge block, emit ALL its FILL lines first (each as its own step), then the CLICK line. Use excelStepRef to label which test step each block corresponds to.
- stepNumber must be a monotonically increasing integer starting at 1 across all steps.
- FILL lines → hasParameter=true, isNavigation=false. parameterName MUST equal the methodName exactly (e.g., methodName "enterEmail" → parameterName "enterEmail").
- finalAssertion.parameterName MUST equal finalAssertion.methodName exactly.
- Each entry in parameters[] must have name = the parameterName of the step that uses it, in the order steps appear.
- CLICK lines → hasParameter=false, isNavigation=true.
- pageClass for each step = the left side of the edge block header (PageA from [PageA → PageB]).
- Only use methodNames that appear exactly in the FILL/CLICK lines of the graph. Never invent method names.
- CRITICAL: Only emit steps for edges that appear in the graph traversal. Do NOT invent steps for transitions not listed.
- Every step MUST have both pageClass and methodName. Drop any step missing either.
- Put assertion logic in finalAssertion. The last step in steps[] is the final user action.
- testMethodName must be a valid Java identifier.
- If path is unclear, still return JSON — reflect uncertainty in confidence."""


class PlannerState(TypedDict):
    tc_name: str
    description: str
    graph_summary: str
    registry_summary: str
    steps_summary: str
    raw_response: str
    result: dict
    error: str
    llm_usage: dict


_INPUT_TYPES = {"textbox", "input", "textarea", "select", "combobox", "radio", "checkbox"}


def _build_registry_index(registry: list[dict]) -> tuple[dict[str, dict], dict[str, str]]:
    sk_to_method: dict[str, dict] = {}
    sk_to_class:  dict[str, str]  = {}
    for m in registry:
        sk = m.get("selectorKey", "")
        if sk:
            sk_to_method[sk] = m
            sk_to_class[sk]  = m["className"]
    return sk_to_method, sk_to_class


def _build_pageref_class_map(
    graph: dict, sk_to_class: dict[str, str]
) -> tuple[dict[str, str], dict[str, int]]:
    nodes = graph.get("nodes", {})
    if isinstance(nodes, list):
        nodes = {n.get("nodeId", str(i)): n for i, n in enumerate(nodes)}

    sk_pageref_set: dict[str, set] = {}
    for node in nodes.values():
        pr = node.get("pageRef", "") or node.get("nodeId", "")
        elements = node.get("elements") or node.get("ownElements") or []
        for el in elements:
            sk = el.get("_selector") or el.get("selectorKey") or el.get("interactionKey") or ""
            if sk:
                sk_pageref_set.setdefault(sk, set()).add(pr)
    sk_page_count: dict[str, int] = {sk: len(prs) for sk, prs in sk_pageref_set.items()}

    result: dict[str, str] = {}
    for node in nodes.values():
        page_ref = node.get("pageRef", "")
        if not page_ref or page_ref in result:
            continue
        elements = node.get("elements") or node.get("ownElements") or []
        scores: dict[str, int] = {}
        for el in elements:
            sk = el.get("_selector") or el.get("selectorKey") or el.get("interactionKey") or ""
            if sk and sk in sk_to_class and sk_page_count.get(sk, 0) == 1:
                cls = sk_to_class[sk]
                scores[cls] = scores.get(cls, 0) + 1
        if scores:
            result[page_ref] = max(scores, key=lambda k: scores[k])
    return result, sk_page_count


def _build_edge_traversal(
    graph: dict,
    sk_to_method: dict[str, dict],
    pageref_to_class: dict[str, str],
) -> str:
    """Deterministic BFS traversal of graph edges.
    For each edge emits: [FromPage → ToPage], Intent, FILL lines, CLICK line.
    Edge spec.intent (set at crawl-time) provides the intent label.
    """
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, list):
        node_map: dict = {n.get("nodeId", str(i)): n for i, n in enumerate(raw_nodes)}
    else:
        node_map = raw_nodes

    edges = graph.get("edges", [])

    # Index: nodeId → list of outgoing edges
    outgoing: dict[str, list] = {}
    all_to_ids: set[str] = set()
    for e in edges:
        fid = e.get("from") or e.get("fromNodeId", "")
        tid = e.get("to")   or e.get("toNodeId", "")
        outgoing.setdefault(fid, []).append(e)
        all_to_ids.add(tid)

    # Root nodes: fromNodeIds that never appear as a toNodeId
    all_from_ids = set(outgoing.keys())
    root_ids = all_from_ids - all_to_ids
    if not root_ids:
        root_ids = all_from_ids  # fallback: no clear root, use all from-nodes

    def _class_for_node(node: dict) -> str:
        if node.get("className"):
            cn = node["className"]
            return cn if cn.endswith("Page") else cn + "Page"
        pr = node.get("pageRef", "")
        if pr and pr in pageref_to_class:
            return pageref_to_class[pr]
        return pr or node.get("nodeId", "Unknown")

    def _node_els(node: dict) -> list:
        els = node.get("elements") or node.get("ownElements") or []
        return els if isinstance(els, list) else []

    # elementId → selectorKey for a node
    def _eid_to_sk(node: dict) -> dict[str, str]:
        result: dict[str, str] = {}
        for el in _node_els(node):
            eid = el.get("id") or el.get("elementId") or ""
            sk  = el.get("_selector") or el.get("selectorKey") or el.get("interactionKey") or ""
            if eid and sk:
                result[eid] = sk
        return result

    def _method_sig(m: dict, cls: str, el_type: str = "") -> str:
        params = list(m.get("parameterNames", []))
        if not params and el_type in ("textbox", "input", "textarea"):
            params = ["value"]
        return f"{cls}.{m['methodName']}({', '.join(params)})"

    lines: list[str] = []
    seen_edge_pairs: set = set()
    visited_queue = list(root_ids)
    visited_nodes: set[str] = set(root_ids)

    while visited_queue:
        from_id = visited_queue.pop(0)
        for e in outgoing.get(from_id, []):
            to_id    = e.get("to") or e.get("toNodeId", "")
            pair_key = (from_id, to_id)
            if pair_key in seen_edge_pairs:
                continue
            seen_edge_pairs.add(pair_key)

            from_node  = node_map.get(from_id, {})
            to_node    = node_map.get(to_id, {})
            from_class = _class_for_node(from_node)
            to_class   = _class_for_node(to_node)

            # Intent from crawl-time spec, falling back to trigger element name
            spec   = e.get("spec") or {}
            intent = spec.get("intent") or ""
            if not intent:
                trigger = e.get("trigger", {})
                intent  = (trigger.get("elementName") if isinstance(trigger, dict) else None) or e.get("label", "")

            lines.append(f"\n[{from_class} → {to_class}]")
            if intent:
                lines.append(f"Intent: {intent}")

            # FILL lines from prerequisiteActions
            trigger_dict = e.get("trigger", {}) if isinstance(e.get("trigger"), dict) else {}
            prereqs      = trigger_dict.get("prerequisiteActions") or []
            eid_to_sk    = _eid_to_sk(from_node)
            edge_seen_sks: set[str] = set()

            for pa in prereqs:
                if pa.get("action") not in ("fill", "select"):
                    continue
                pa_eid  = pa.get("elementId", "")
                pa_name = pa.get("elementName", "") or ""
                pa_type = (pa.get("elementType") or "textbox").lower()
                sk      = eid_to_sk.get(pa_eid, "")
                if sk in edge_seen_sks:
                    continue
                edge_seen_sks.add(sk)
                if sk and sk in sk_to_method:
                    sig = _method_sig(sk_to_method[sk], from_class, pa_type)
                else:
                    synth = f"enter{''.join(w.capitalize() for w in pa_name.split())}"
                    sig   = f"{from_class}.{synth}(value)"
                lines.append(f'FILL  "{pa_name}" → {sig}')

            # CLICK line — the edge trigger
            trig_eid    = trigger_dict.get("elementId", "")
            trig_name   = trigger_dict.get("elementName") or e.get("label", "")
            trig_sk     = eid_to_sk.get(trig_eid, "")
            if trig_sk and trig_sk in sk_to_method:
                click_sig = _method_sig(sk_to_method[trig_sk], from_class)
            else:
                mname     = f"click{''.join(w.capitalize() for w in trig_name.split())}" if trig_name else "click"
                click_sig = f"{from_class}.{mname}()"
            lines.append(f'CLICK "{trig_name}" → {click_sig}')

            # Enqueue toNode for BFS
            if to_id not in visited_nodes:
                visited_nodes.add(to_id)
                visited_queue.append(to_id)

    return "\n".join(lines)


def _build_steps_summary(steps: list) -> str:
    if not steps:
        return ""
    lines = ["Test Steps — match each step's intent to the corresponding edge block(s) in the graph:"]
    for s in steps:
        num      = s.get("number", "")
        action   = (s.get("step") or "").strip()
        expected = (s.get("expected") or "").strip()
        line = f"  Step {num}: {action}"
        if expected:
            line += f"  →  Expected: {expected}"
        lines.append(line)
    return "\n".join(lines)


def _build_registry_summary(registry: list[dict], description: str) -> str:
    keywords = set(description.lower().split())
    scored = []
    for entry in registry:
        score = sum(1 for kw in keywords if kw in entry.get("description", "").lower()
                    or kw in entry.get("methodName", "").lower())
        scored.append((score, entry))
    scored.sort(key=lambda x: -x[0])
    top = scored[:100] if len(scored) > 100 else scored
    lines = []
    for _, e in top:
        attrs = e.get("allAttributes") or {}
        human_label = (
            attrs.get("ariaLabel") or attrs.get("placeholder") or
            attrs.get("ariaPlaceholder") or attrs.get("title") or
            attrs.get("textContent") or attrs.get("name") or ""
        )
        attr_hints = ", ".join(filter(None, [
            f"type={attrs['type']}"        if attrs.get("type")        else None,
            f"label={human_label}"         if human_label              else None,
            f"required"                    if attrs.get("required")    else None,
        ]))
        lines.append(
            f"- {e['className']}.{e['methodName']}({', '.join(e.get('parameterNames', []))})"
            f" → {e.get('returnType', '')} | {e.get('description', '')}"
            + (f" [{attr_hints}]" if attr_hints else "")
        )
    return "\n".join(lines)


def _call_llm(state: PlannerState) -> PlannerState:
    model = ChatOpenAI(
        model="gpt-4o",
        api_key=os.environ["OPENAI_API_KEY"],
        max_tokens=2000
    )
    steps_section = f"\n\n{state['steps_summary']}" if state['steps_summary'] else ""
    user_content = (
        f"Test Case Name: {state['tc_name']}\n"
        f"Description: {state['description']}"
        f"{steps_section}\n\n"
        f"Application Graph (edge traversal):\n{state['graph_summary']}\n\n"
        f"Available POM Methods:\n{state['registry_summary']}"
    )
    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    response = model.invoke(messages)
    usage = getattr(response, "usage_metadata", {}) or {}
    inp  = usage.get("input_tokens", 0)
    out  = usage.get("output_tokens", 0)
    cost = round((inp * 5 + out * 15) / 1_000_000, 6)
    return {**state, "raw_response": str(response.content),
            "llm_usage": {"inputTokens": inp, "outputTokens": out, "costUsd": cost, "model": "gpt-4o"}}


def _parse_result(state: PlannerState) -> PlannerState:
    try:
        result = json.loads(state["raw_response"])
        steps = result.get("steps", [])
        valid = sorted(
            [s for s in steps if s.get("methodName") and s.get("pageClass")],
            key=lambda s: s.get("stepNumber", 9999)
        )
        if len(valid) < len(steps):
            logger.warning(f"Dropped {len(steps) - len(valid)} steps missing methodName/pageClass")
        result["steps"] = valid
        # Ensure startingClass is always set — derive from first step's pageClass if LLM omitted it
        if not result.get("startingClass") and valid:
            result["startingClass"] = valid[0]["pageClass"]
        return {**state, "result": result, "error": ""}
    except json.JSONDecodeError as e:
        logger.warning(f"JSON parse failed: {e} — raw: {state['raw_response'][:200]}")
        return {**state, "result": {
            "testMethodName": state["tc_name"].replace(" ", "_"),
            "startingClass": "",
            "steps": [],
            "parameters": [],
            "finalAssertion": {},
            "confidence": 0.0,
            "reasoning": f"JSON parse failed: {e}"
        }, "error": str(e)}


def _build_graph():  # type: ignore[return]
    workflow = StateGraph(PlannerState)
    workflow.add_node("call_llm", _call_llm)
    workflow.add_node("parse_result", _parse_result)
    workflow.set_entry_point("call_llm")
    workflow.add_edge("call_llm", "parse_result")
    workflow.add_edge("parse_result", END)
    return workflow.compile()


_planner_graph: object = None  # type: ignore[assignment]


def _get_graph():
    global _planner_graph
    if _planner_graph is None:
        _planner_graph = _build_graph()
    return _planner_graph


async def plan(
    tc_name: str,
    description: str,
    graph: dict,
    registry: list[dict],
    steps: list = []
) -> dict:
    sk_to_method, sk_to_class = _build_registry_index(registry)
    pageref_to_class, _       = _build_pageref_class_map(graph, sk_to_class)
    graph_summary    = _build_edge_traversal(graph, sk_to_method, pageref_to_class)
    registry_summary = _build_registry_summary(registry, description)
    steps_summary    = _build_steps_summary(steps)

    logger.debug(f"Edge traversal for {tc_name}:\n{graph_summary}")

    initial_state: PlannerState = {
        "tc_name":          tc_name,
        "description":      description,
        "graph_summary":    graph_summary,
        "registry_summary": registry_summary,
        "steps_summary":    steps_summary,
        "raw_response":     "",
        "result":           {},
        "error":            "",
        "llm_usage":        {},
    }

    planner = _get_graph()
    final_state = await planner.ainvoke(initial_state)  # type: ignore[union-attr]
    result = final_state["result"]
    result["llm_usage"] = final_state.get("llm_usage", {})

    if result.get("confidence", 0) < 0.75:
        result["status"] = "NEEDS_REVIEW"
        result["review_reason"] = f"Low confidence: {result.get('confidence', 0):.2f}"
    else:
        result["status"] = "READY"

    logger.info(f"Plan for {tc_name}: confidence={result.get('confidence', 0):.2f} status={result.get('status')}")
    return result
