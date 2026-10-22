---
'@ai-sdk/google': patch
---

Preserve empty arrays and objects, including nested containers, in Vertex tool-call inputs when `streamFunctionCallArguments` is enabled. Handle value-less container markers without overwriting previously streamed values, and include empty containers in tool input text deltas.
