"""The Marryo Film Director root agent.

Phase 0: no tools are wired up yet. Tools land in agent/tools/ from Phase 1 onwards and
get passed to the agent through the `tools` argument below.
"""

import os

from google.adk.agents import Agent

from . import prompts

MODEL = os.environ.get("MARRYO_MODEL", "gemini-2.5-flash")

root_agent = Agent(
    name="marryo_film_director",
    model=MODEL,
    description=prompts.DESCRIPTION,
    instruction=prompts.INSTRUCTION,
    tools=[],
)
