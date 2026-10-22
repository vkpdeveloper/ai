---
'ai': patch
---

Fix streamText retries being skipped when a provider emits an error part and then errors the stream while an async onError or onChunk callback is running. Ignore cancellation failures for discarded attempts so automatic and callback-requested retries still run.
