---
'@ai-sdk/xai': patch
---

Fix xAI Responses non-streaming finish reasons by reading `incomplete_details.reason`. Responses truncated by `max_output_tokens` now report `length` and preserve the raw reason, matching streaming responses.
