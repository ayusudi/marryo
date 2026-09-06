"""The Marryo Film Director root agent."""

import os

from google.adk.agents import Agent

from . import prompts
from tools import (
    analyze_clip,
    generate_story,
    plan_edit,
    query_candidate_moments,
    score_moments,
    validate_edl,
)

MODEL = os.environ.get("MARRYO_MODEL", "gemini-2.5-flash")

root_agent = Agent(
    name="marryo_film_director",
    model=MODEL,
    description=prompts.DESCRIPTION,
    instruction=prompts.INSTRUCTION,
    tools=[
        analyze_clip,
        score_moments,
        query_candidate_moments,
        generate_story,
        plan_edit,
        validate_edl,
    ],
)
