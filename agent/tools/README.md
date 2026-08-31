# ADK tools

One file per tool, one exported function per file. ADK derives the tool schema from the
function signature and docstring, so both are part of the prompt surface: name arguments
the way you want the model to think about them, and describe the return value.

```python
# tools/validate_clip.py
def validate_clip(clip_id: str) -> dict:
    """Check that an uploaded clip is usable footage.

    Args:
        clip_id: Identifier of the clip to validate.

    Returns:
        A dict with `status` ("ok" or "rejected") and, when rejected, `reason`.
    """
```

Register a tool by importing it in `tools/__init__.py` and adding it to the `tools` list
in `marryo_agent/agent.py`.

Heavy video work belongs in `agent/cv/`. Tools stay thin: validate arguments, call into
`cv/`, and return a small JSON-serialisable dict the model can reason about. Never return
raw frames or multi-megabyte payloads to the model.
