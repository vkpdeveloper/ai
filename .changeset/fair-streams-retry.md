---
'ai': patch
---

Fix streamText skipping stream retries when a provider stream errors after an error part while an async onError or onChunk callback is pending. Cancellation failures from discarded attempts no longer prevent automatic or callback-requested retries.
