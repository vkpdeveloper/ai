---
'@ai-sdk/workflow': patch
'@ai-sdk/otel': patch
'ai': patch
---

Fix missing WorkflowAgent tool execution telemetry with globally registered integrations by reporting each tool's lifecycle from a durable step. Preserve measured execution timestamps, tool results and errors, telemetry recording settings, and context inclusion rules. OpenTelemetry integrations now honor optional tool event timestamps when reporting deferred execution.
