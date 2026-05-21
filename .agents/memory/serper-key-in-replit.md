---
name: SERPER_API_KEY in .replit userenv.shared
description: Real API key committed in .replit [userenv.shared] — security note
---

## Rule
`.replit` contains `SERPER_API_KEY` in `[userenv.shared]`. This value is committed to git and visible to anyone with repo access.

**Why it matters:** Any fork or import of the repo gets this key for free. The key should live in Replit Secrets instead. Do not rotate or remove this value without warning the user — the current running app depends on it.

**How to apply:** When touching `.replit` or discussing secrets, note this. Recommend the user move SERPER_API_KEY to Replit Secrets and clear `[userenv.shared]` from `.replit`. Do not make this change silently.
