---
'@ai-sdk/workflow': patch
'@ai-sdk/otel': patch
'ai': patch
---

Fix missing tool execution telemetry for WorkflowAgent with globally registered integrations. Dispatch completed tool lifecycles in a durable step, preserve the original execution timing, and export standalone OpenTelemetry tool spans for successful and failed tools.
