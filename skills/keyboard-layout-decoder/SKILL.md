---
name: keyboard-layout-decoder
description: Decode text typed with wrong keyboard layout. Converts between Russian and English (ЙЦУКЕН/QWERTY). Use when text looks garbled or user mentions wrong layout.
---

# Keyboard Layout Decoder

```bash
bun ./decoder.ts "text to decode"
```

Auto-detects direction: `ghbdtn` → `привет`, `ьфсищщл` → `macbook`
