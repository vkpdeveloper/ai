---
'@ai-sdk/xai': patch
---

Fix Responses API non-streaming finish reasons by reading `incomplete_details.reason`, so responses truncated by `max_output_tokens` report `length` and preserve the raw reason.
