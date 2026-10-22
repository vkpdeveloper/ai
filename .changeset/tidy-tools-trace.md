---
'@ai-sdk/workflow': patch
'@ai-sdk/otel': patch
'ai': patch
---

Fix missing global tool telemetry in durable WorkflowAgent runs. Dispatch tool lifecycle events from a reporting step after execution and preserve the measured start time and duration in OpenTelemetry spans. Use the current tool output event shape for workflow telemetry integrations.
