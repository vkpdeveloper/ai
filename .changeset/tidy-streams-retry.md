---
'ai': patch
---

Fix `streamText` skipping stream retries when a provider stream errors after an error part while an asynchronous `onError` or `onChunk` callback is running.
