---
'ai': patch
---

Fix `streamText` skipping automatic or callback-requested stream retries when the provider stream errors after an error part while an asynchronous `onError` or `onChunk` callback is running.
