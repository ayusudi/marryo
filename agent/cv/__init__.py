"""Computer-vision helpers for the Marryo Film Director.

Plain Python, no LLM calls. The ADK tools in agent/tools/ are thin wrappers that call
into this package and return small JSON-serialisable results.

Modules are imported lazily by callers rather than re-exported here, so that importing
one helper does not pay the import cost of mediapipe and opencv all at once.
"""

__all__ = ["identity", "scenes", "validate"]
