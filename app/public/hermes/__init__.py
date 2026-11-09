"""Agent Reviews for Hermes: adds ratings to x402 and MPP wallet search results.

The wallet logic is all in hook.mjs, which this runs after a wallet search. It
sends only the domains of the APIs returned, and stays silent on any failure.
"""

import json
import os
import re
import subprocess
from pathlib import Path

WALLET_TOOL = re.compile(
    r"^mcp__.*(agentcash|bazaar|search_resources|search_skills|search_services"
    r"|list_services|recommend_services|search_offers|get_service|x402|402index"
    r"|agent-?tools|decixa)",
    re.IGNORECASE,
)
WALLET_COMMAND = re.compile(r"\b(awal|agentcash|pay\s+skills|tempo\s+wallet)\b")
TIMEOUT_SECONDS = 4


def _script():
    default = Path.home() / ".config" / "agent-reviews" / "hook.mjs"
    return os.environ.get("AGENT_REVIEWS_HOOK", str(default))


def _event(tool_name, args, result):
    if tool_name != "terminal":
        if WALLET_TOOL.search(tool_name or ""):
            return {
                "tool_name": tool_name,
                "tool_input": args or {},
                "tool_response": result,
            }
        return None
    command = (args or {}).get("command") or ""
    if not WALLET_COMMAND.search(command):
        return None
    try:
        stdout = json.loads(result).get("output", "")
    except (AttributeError, TypeError, ValueError):
        stdout = result
    return {
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "tool_response": {"stdout": stdout},
    }


def _ratings(event):
    try:
        done = subprocess.run(
            ["node", _script(), "plain"],
            input=json.dumps(event),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError, TypeError, ValueError):
        return ""
    return done.stdout if done.returncode == 0 else ""


def _add_ratings(tool_name=None, args=None, result=None, **_kwargs):
    if not isinstance(result, str):
        return None
    event = _event(tool_name, args, result)
    text = _ratings(event) if event else ""
    if not text:
        return None
    try:
        parsed = json.loads(result)
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        parsed["agent_reviews"] = text
        return json.dumps(parsed, ensure_ascii=False)
    return f"{result}\n\n{text}"


def register(ctx):
    ctx.register_hook("transform_tool_result", _add_ratings)
