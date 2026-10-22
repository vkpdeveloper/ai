---
"@ai-sdk/workflow": patch
"@ai-sdk/otel": patch
"ai": patch
---

Fix missing WorkflowAgent tool telemetry with globally registered integrations. Dispatch completed tool executions from a durable step and preserve their measured start time and duration in OpenTelemetry tool spans, including when model telemetry runs in a separate process.
