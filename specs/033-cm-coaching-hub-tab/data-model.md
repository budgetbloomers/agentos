# Data model: 033 — the Coaching Hub, exactly as it is, as a campaign manager tab

No data. No table, no migration, no Worker payload, no key.

## Page state (agent/index.html)

```
CMHUB = { el: null | <iframe>,   // the one frame, outside #root
          loaded: false,         // onload seen
          failed: false,         // 20 s without onload → words + Retry
          timer: 0 }
HUB_APP_URL = 'https://coaching-hub-psi.vercel.app/'   // one constant; the footer link elsewhere reuses it
```

## Headers (site/_headers, committed source)

`Content-Security-Policy: … ; frame-src https://coaching-hub-psi.vercel.app; …` — one origin added; nothing removed.
