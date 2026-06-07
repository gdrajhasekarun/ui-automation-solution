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
      "pageClass": "LoginPage",
      "methodName": "enterEmail",
      "hasParameter": true,
      "parameterName": "email",
      "parameterType": "String",
      "isNavigation": false
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
- Only use methods from the POM registry
- Last step must always be an assertion
- Never emit parent page methods when on a child page
- testMethodName must be a valid Java identifier
- If path is unclear, still return JSON — reflect uncertainty in confidence"""


class PlannerState(TypedDict):
    tc_name: str
    description: str
    graph_summary: str
    registry_summary: str
    raw_response: str
    result: dict
    error: str


def _build_graph_summary(graph: dict) -> str:
    lines = []
    for node in graph.get("nodes", [])[:50]:
        title = node.get("title", "")
        edges_out = [e.get("label", e.get("selectorKey", "")) for e in graph.get("edges", [])
                     if e.get("fromNodeId") == node.get("nodeId")]
        lines.append(f"- {title}: {', '.join(edges_out[:5]) or 'no outgoing edges'}")
    summary = "\n".join(lines)
    return summary[:3000]


def _build_registry_summary(registry: list[dict], description: str) -> str:
    keywords = set(description.lower().split())
    scored = []
    for entry in registry:
        score = sum(1 for kw in keywords if kw in entry.get("description", "").lower()
                    or kw in entry.get("methodName", "").lower())
        scored.append((score, entry))
    scored.sort(key=lambda x: -x[0])
    top = scored[:100] if len(scored) > 100 else scored
    lines = [
        f"- {e['className']}.{e['methodName']}({', '.join(e.get('parameterNames', []))})"
        f" → {e.get('returnType', '')} | {e.get('description', '')}"
        for _, e in top
    ]
    return "\n".join(lines)


def _call_llm(state: PlannerState) -> PlannerState:
    model = ChatOpenAI(
        model="gpt-4o",
        api_key=os.environ["OPENAI_API_KEY"],
        max_tokens=2000
    )
    user_content = (
        f"Test Case Name: {state['tc_name']}\n"
        f"Description: {state['description']}\n\n"
        f"Application Graph Summary:\n{state['graph_summary']}\n\n"
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
    registry: list[dict]
) -> dict:
    graph_summary = _build_graph_summary(graph)
    registry_summary = _build_registry_summary(registry, description)

    initial_state: PlannerState = {
        "tc_name": tc_name,
        "description": description,
        "graph_summary": graph_summary,
        "registry_summary": registry_summary,
        "raw_response": "",
        "result": {},
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
