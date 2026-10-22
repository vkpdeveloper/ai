---
'@ai-sdk/google': patch
---

Preserve empty arrays and objects, including nested containers, in Vertex tool-call inputs when `streamFunctionCallArguments` is enabled. Handle value-less container paths without overwriting previously streamed values, and include the containers in both input deltas and the final tool call.
