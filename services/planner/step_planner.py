import json
import logging
import os
from typing import TypedDict, Annotated
import operator

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

logger = logging.getLogger("planner.step_planner")

SYSTEM_PROMPT = """You are a test automation expert. Resolve natural language test case descriptions
into Selenium Page Object Model method sequences.

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
      "parameterName": "email",
      "parameterType": "String",
      "isNavigation": false,
      "humanReadable": "Enter email address in the email field"
    }
  ],
  "parameters": [
    { "name": "email", "type": "String" },
    { "name": "password", "type": "String" },
    { "name": "expectedTitle", "type": "String" }
  ],
  "finalAssertion": {
    "methodName": "assertTitle",
    "parameterName": "expectedTitle"
  },
  "confidence": 0.94,
  "reasoning": "one sentence"
}

Rules:
- The application launch (driver.get to the base URL) is handled automatically by @BeforeMethod — do NOT emit a launch step. Begin the test method steps from the first user interaction on the starting page.
- The Excel Test Steps define the ORDERED GOALS. For each goal, trace the Application Graph to find which page and element satisfies it, then emit the corresponding POM method call(s).
- Use each page's Intent description to identify which graph page matches each Excel step goal.
- Follow navigation edges to move between pages — each edge traversal becomes a step.
- Only use methods from the POM registry.
- Add a humanReadable field per step describing what the step does in plain English.
- Add an excelStepRef field (integer) to each step indicating which Excel step number it implements (1-based). Group multiple atomic steps under the same excelStepRef when they all contribute to the same Excel step goal.
- When a path requires entering text or searching (e.g. a search box, keyword input, HCPC field), ALWAYS use a method that accepts a parameter (e.g. enterKeyword("value"), searchFor("value")) — never replace a search/input action with a pure click-navigation method.
- Prefer methods with parameters over parameterless click methods when the step involves user input or data entry.
- Last step must always be an assertion.
- Never emit parent page methods when on a child page.
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


_INPUT_TYPES = {"textbox", "input", "textarea", "select", "combobox", "radio", "checkbox"}
_SKIP_LABELS = {
    "here's how you know", "sign up", "enter your email address:",
    "privacy settings", "help with file formats and plug-ins",
    "rss feed link", "linkedin link", "youtube link", "facebook link", "twitter link",
}


def _build_graph_summary(graph: dict) -> str:
    raw_nodes = graph.get("nodes", {})
    if isinstance(raw_nodes, dict):
        nodes_iter = list(raw_nodes.items())
        node_map: dict = raw_nodes
    else:
        nodes_iter = [(n.get("nodeId", str(i)), n) for i, n in enumerate(raw_nodes)]
        node_map = {n.get("nodeId", str(i)): n for i, n in enumerate(raw_nodes)}

    edges = graph.get("edges", [])

    # Pre-index outgoing edges per node
    outgoing_edges: dict = {}
    for e in edges:
        from_id = e.get("from") or e.get("fromNodeId", "")
        outgoing_edges.setdefault(from_id, []).append(e)

    lines: list[str] = []
    for nid, node in nodes_iter[:20]:
        title    = node.get("title", node.get("url", ""))
        page_ref = node.get("pageRef") or node.get("className", "")
        intent   = node.get("spec", {}).get("intent", "") if isinstance(node.get("spec"), dict) else ""
        lines.append(f"\n## Page: {title}")
        lines.append(f"   POM class: {page_ref}")
        if intent:
            lines.append(f"   Purpose: {intent}")

        elements = node.get("elements", [])

        # Collect trigger elementIds for outgoing edges from this node
        trigger_el_ids: set = set()
        for e in outgoing_edges.get(nid, []):
            t = e.get("trigger", {})
            if isinstance(t, dict) and t.get("elementId"):
                trigger_el_ids.add(t["elementId"])

        # Show only input fields and edge-trigger elements (skip nav/footer noise)
        for el in elements:
            el_type = (el.get("elementType") or el.get("role") or el.get("tag", "")).lower()
            label   = (el.get("label") or el.get("name") or "").strip()
            sel     = el.get("_selector") or el.get("selectorKey") or el.get("interactionKey", "")
            el_id   = el.get("elementId", "")
            if label.lower() in _SKIP_LABELS:
                continue
            if el_type in _INPUT_TYPES:
                lines.append(f"   INPUT  [{el_type}] \"{label}\"  selector={sel}")
            elif el_id in trigger_el_ids:
                lines.append(f"   TRIGGER[{el_type}] \"{label}\"  selector={sel}")

        # Describe each outgoing edge as an explicit FLOW block
        for e in outgoing_edges.get(nid, []):
            to_id      = e.get("to") or e.get("toNodeId", "")
            dest       = node_map.get(to_id, {})
            dest_title = dest.get("title", to_id) if isinstance(dest, dict) else to_id
            dest_ref   = dest.get("pageRef", "") if isinstance(dest, dict) else ""
            trigger    = e.get("trigger", {})
            el_name    = (trigger.get("elementName") if isinstance(trigger, dict) else None) or e.get("label", "")

            # Input fields on this page that logically precede the trigger click
            inputs_before = [
                el for el in elements
                if (el.get("elementType") or "").lower() in _INPUT_TYPES
                and (el.get("label") or "").lower() not in _SKIP_LABELS
            ]

            lines.append(f"   FLOW →")
            step = 1
            for inp in inputs_before:
                inp_label = (inp.get("label") or inp.get("name") or "").strip()
                inp_sel   = inp.get("_selector") or inp.get("selectorKey") or ""
                lines.append(f"     {step}. Enter value in \"{inp_label}\" ({inp_sel}) — call the POM method for this field")
                step += 1
            lines.append(f"     {step}. Click \"{el_name}\" → navigates to: {dest_title}  (POM class: {dest_ref})")

    return "\n".join(lines)[:7000]


def _build_steps_summary(steps: list) -> str:
    if not steps:
        return ""
    lines = ["Excel Test Steps — implement each step in order using graph paths and POM methods:"]
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
        # Build a compact label from the richest available attribute
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
        f"Application Graph (pages with specs, elements, navigation):\n{state['graph_summary']}\n\n"
        f"Available POM Methods:\n{state['registry_summary']}"
    )
    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    response = model.invoke(messages)
    return {**state, "raw_response": response.content}


def _parse_result(state: PlannerState) -> PlannerState:
    try:
        result = json.loads(state["raw_response"])
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


def _build_graph() -> StateGraph:
    workflow = StateGraph(PlannerState)
    workflow.add_node("call_llm", _call_llm)
    workflow.add_node("parse_result", _parse_result)
    workflow.set_entry_point("call_llm")
    workflow.add_edge("call_llm", "parse_result")
    workflow.add_edge("parse_result", END)
    return workflow.compile()


_planner_graph = None


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
    graph_summary    = _build_graph_summary(graph)
    registry_summary = _build_registry_summary(registry, description)
    steps_summary    = _build_steps_summary(steps)

    initial_state: PlannerState = {
        "tc_name":          tc_name,
        "description":      description,
        "graph_summary":    graph_summary,
        "registry_summary": registry_summary,
        "steps_summary":    steps_summary,
        "raw_response":     "",
        "result":           {},
        "error": ""
    }

    planner = _get_graph()
    final_state = await planner.ainvoke(initial_state)
    result = final_state["result"]

    if result.get("confidence", 0) < 0.75:
        result["status"] = "NEEDS_REVIEW"
        result["review_reason"] = f"Low confidence: {result.get('confidence', 0):.2f}"
    else:
        result["status"] = "READY"

    logger.info(f"Plan for {tc_name}: confidence={result.get('confidence', 0):.2f} status={result.get('status')}")
    return result
