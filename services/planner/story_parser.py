import json
import logging
import os

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger("planner.story_parser")

SYSTEM_PROMPT = """You are a test automation architect. A user provides a user story and acceptance criteria.
Extract the following into a JSON object — no markdown, no fences, raw JSON only.

{
  "flow_name": "kebab-case-identifier",
  "goal": "One sentence describing what this flow accomplishes",
  "hints": [
    { "field": "username", "value": "admin" }
  ],
  "seed_url": null
}

Rules:
- flow_name: short kebab-case label (e.g. "user-login", "checkout-flow", "password-reset")
- goal: one clear sentence summarising the user's intent
- hints: extract any concrete field values, credentials, or data mentioned in the story (empty array if none)
- seed_url: a specific URL only if the story explicitly mentions one, otherwise null
- Return ONLY valid JSON. No explanation."""


def _build_llm():
    return ChatOpenAI(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
        api_key=os.environ["OPENAI_API_KEY"],
        max_tokens=500
    )


async def parse_story(user_story: str, app_url: str) -> dict:
    try:
        llm = _build_llm()
        user_content = (
            f"Application URL: {app_url}\n\n"
            f"User Story:\n{user_story}"
        )
        messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
        response = llm.invoke(messages)
        result = json.loads(response.content)
        logger.info(f"Story parsed — flow_name={result.get('flow_name')} hints={len(result.get('hints', []))}")
        return result
    except json.JSONDecodeError as e:
        logger.warning(f"Story parse JSON error: {e}")
        return {"error": f"LLM returned invalid JSON: {e}"}
    except Exception as e:
        logger.error(f"Story parse failed: {e}")
        return {"error": str(e)}
