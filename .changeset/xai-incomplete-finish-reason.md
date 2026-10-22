---
'@ai-sdk/xai': patch
---

Fix xAI Responses non-streaming generation reporting `other` instead of `length` when `max_output_tokens` truncates a response. Preserve `incomplete_details.reason` as the raw finish reason, matching streaming responses.
