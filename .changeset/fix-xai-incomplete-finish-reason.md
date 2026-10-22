---
'@ai-sdk/xai': patch
---

Fix xAI Responses non-streaming generation reporting `other` instead of `length` when output is truncated by `max_output_tokens`. Use `incomplete_details.reason` for the finish reason and preserve it as the raw finish reason, falling back to the response status when details are absent.
