---
'@ai-sdk/google': patch
'@ai-sdk/google-vertex': patch
---

Preserve empty arrays and objects, including nested containers, in Vertex tool-call inputs when `streamFunctionCallArguments` is enabled. Value-less container markers now emit the missing values without overwriting previously streamed arguments.
