---
name: agent-browser
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
---

# Browser Automation with agent-browser

## Installation

```bash
npm install -g agent-browser
agent-browser install  # Download Chromium
```

## Quick Start

```bash
agent-browser open <url>        # Navigate to page
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser close             # Close browser
```

## Core Workflow

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

### Navigation

```bash
agent-browser open <url>      # Navigate to URL (aliases: goto, navigate)
agent-browser back            # Go back
agent-browser forward         # Go forward
agent-browser reload          # Reload page
agent-browser close           # Close browser (aliases: quit, exit)
```

### Snapshot (Page Analysis)

```bash
agent-browser snapshot        # Full accessibility tree
agent-browser snapshot -i     # Interactive elements only (recommended)
agent-browser snapshot -c     # Compact output
agent-browser snapshot -d 3   # Limit depth to 3
agent-browser snapshot -s "#main"  # Scope to selector
```

### Interactions (use @refs from snapshot)

```bash
agent-browser click @e1           # Click
agent-browser dblclick @e1        # Double-click
agent-browser fill @e2 "text"     # Clear and type
agent-browser type @e2 "text"     # Type without clearing
agent-browser press Enter         # Press key (alias: key)
agent-browser press Control+a     # Key combination
agent-browser keydown Shift       # Hold key down
agent-browser keyup Shift         # Release key
agent-browser hover @e1           # Hover
agent-browser focus @e1           # Focus element
agent-browser check @e1           # Check checkbox
agent-browser uncheck @e1         # Uncheck checkbox
agent-browser select @e1 "value"  # Select dropdown
agent-browser scroll down 500     # Scroll page
agent-browser scrollintoview @e1  # Scroll element into view (alias: scrollinto)
agent-browser drag @e1 @e2        # Drag and drop
agent-browser upload @e1 file.pdf # Upload files
```

### Get Information

```bash
agent-browser get text @e1        # Get element text
agent-browser get html @e1        # Get innerHTML
agent-browser get value @e1       # Get input value
agent-browser get attr @e1 href   # Get attribute
agent-browser get title           # Get page title
agent-browser get url             # Get current URL
agent-browser get count ".item"   # Count matching elements
agent-browser get box @e1         # Get bounding box
```

### Check State

```bash
agent-browser is visible @e1      # Check if visible
agent-browser is enabled @e1      # Check if enabled
agent-browser is checked @e1      # Check if checked
```

### Screenshots

```bash
agent-browser screenshot          # Screenshot to temp file
agent-browser screenshot path.png # Save to file
agent-browser screenshot --full   # Full page
agent-browser screenshot @e1      # Screenshot specific element
```

### Wait

```bash
agent-browser wait @e1                     # Wait for element
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait --text "Success"        # Wait for text
agent-browser wait --url "**/dashboard"    # Wait for URL pattern
agent-browser wait --load networkidle      # Wait for network idle
agent-browser wait --fn "window.ready === true"  # Wait for JS condition
```

### Semantic Locators (alternative to refs)

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search..." fill "query"
agent-browser find first ".item" click
agent-browser find nth 2 "a" text
```

**Actions:** `click`, `fill`, `check`, `hover`, `text`

### Mouse Control

```bash
agent-browser mouse move 100 200     # Move mouse
agent-browser mouse down left        # Press button (left/right/middle)
agent-browser mouse up left          # Release button
agent-browser mouse wheel 100        # Scroll wheel
```

### Tabs & Windows

```bash
agent-browser tab                 # List tabs
agent-browser tab new [url]       # New tab
agent-browser tab 2               # Switch to tab 2
agent-browser tab close [n]       # Close tab
agent-browser window new          # New window
```

### Frames

```bash
agent-browser frame "#iframe"     # Switch to iframe
agent-browser frame main          # Back to main frame
```

### Dialogs

```bash
agent-browser dialog accept [text]   # Accept (with optional prompt text)
agent-browser dialog dismiss         # Dismiss
```

### Cookies & Storage

```bash
agent-browser cookies                    # Get all cookies
agent-browser cookies set name value     # Set cookie
agent-browser cookies clear              # Clear cookies

agent-browser storage local              # Get all localStorage
agent-browser storage local key          # Get specific key
agent-browser storage local set k v      # Set value
agent-browser storage local clear        # Clear all

agent-browser storage session            # Same for sessionStorage
```

### Network

```bash
agent-browser network route <url>              # Intercept requests
agent-browser network route <url> --abort      # Block requests
agent-browser network route <url> --body <json>  # Mock response
agent-browser network unroute [url]            # Remove routes
agent-browser network requests                 # View tracked requests
agent-browser network requests --filter api    # Filter requests
```

### Browser Settings

```bash
agent-browser set viewport 1920 1080      # Set viewport size
agent-browser set device "iPhone 14"      # Emulate device
agent-browser set geo 40.7128 -74.0060    # Set geolocation
agent-browser set offline on              # Toggle offline mode
agent-browser set headers '{"X-Custom": "value"}'  # Extra HTTP headers
agent-browser set credentials user pass   # HTTP basic auth
agent-browser set media dark              # Emulate color scheme
```

### Debug

```bash
agent-browser --headed open example.com   # Show browser window
agent-browser console                     # View console messages
agent-browser console --clear             # Clear console
agent-browser errors                      # View page errors
agent-browser errors --clear              # Clear errors
agent-browser highlight @e1               # Highlight element
agent-browser trace start [path]          # Start recording trace
agent-browser trace stop [path]           # Stop and save trace
agent-browser eval "document.title"       # Run JavaScript
```

### State Management

```bash
agent-browser state save auth.json        # Save auth state
agent-browser state load auth.json        # Load auth state
```

## Sessions (Parallel Browsers)

```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
agent-browser session                     # Show current session
```

Each session has its own browser instance, cookies, storage, and auth state.

## Persistent Profiles

Persist browser state across restarts:

```bash
agent-browser --profile ~/.myapp-profile open myapp.com
# Or via env: AGENT_BROWSER_PROFILE=~/.myapp-profile
```

## JSON Output (for parsing)

Add `--json` for machine-readable output:

```bash
agent-browser snapshot -i --json
agent-browser get text @e1 --json
agent-browser is visible @e1 --json
```

## CDP Mode (Connect to Existing Browser)

```bash
# Start Chrome with: google-chrome --remote-debugging-port=9222

# Connect once, then run commands
agent-browser connect 9222
agent-browser snapshot
agent-browser close

# Or pass --cdp on each command
agent-browser --cdp 9222 snapshot

# Connect via WebSocket URL
agent-browser --cdp "wss://your-browser-service.com/cdp?token=..." snapshot
```

## Control User's Real Browser via Playwriter

Connect to user's actual Chrome browser using the [Playwriter extension](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe).

### Setup (one-time)

1. User installs [Playwriter extension](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)
2. User starts the relay: `bunx playwriter` (starts CDP relay automatically)
3. User clicks Playwriter icon on tabs to control (icon turns green)

### Usage

```bash
agent-browser --cdp 19988 snapshot -i
agent-browser --cdp 19988 fill @e5 "search query"
agent-browser --cdp 19988 click @e3
```

## Authenticated Sessions

Use `--headers` to set HTTP headers scoped to an origin:

```bash
agent-browser open api.example.com --headers '{"Authorization": "Bearer <token>"}'
```

Headers are scoped to the origin only (safe for navigating to other domains).

## Options

| Option | Description |
|--------|-------------|
| `--session <name>` | Use isolated session (or `AGENT_BROWSER_SESSION` env) |
| `--profile <path>` | Persistent browser profile (or `AGENT_BROWSER_PROFILE` env) |
| `--headers <json>` | HTTP headers scoped to URL's origin |
| `--executable-path <path>` | Custom browser executable (or `AGENT_BROWSER_EXECUTABLE_PATH` env) |
| `--args <args>` | Browser launch args (or `AGENT_BROWSER_ARGS` env) |
| `--user-agent <ua>` | Custom User-Agent (or `AGENT_BROWSER_USER_AGENT` env) |
| `--proxy <url>` | Proxy server URL (or `AGENT_BROWSER_PROXY` env) |
| `--proxy-bypass <hosts>` | Hosts to bypass proxy (or `AGENT_BROWSER_PROXY_BYPASS` env) |
| `-p, --provider <name>` | Cloud browser provider (or `AGENT_BROWSER_PROVIDER` env) |
| `--json` | JSON output |
| `--full, -f` | Full page screenshot |
| `--name, -n` | Locator name filter |
| `--exact` | Exact text match |
| `--headed` | Show browser window |
| `--cdp <port>` | Connect via CDP |
| `--ignore-https-errors` | Ignore HTTPS certificate errors |
| `--debug` | Debug output |

## Cloud Browser Providers

### Browserbase

```bash
export BROWSERBASE_API_KEY="your-api-key"
export BROWSERBASE_PROJECT_ID="your-project-id"
agent-browser -p browserbase open https://example.com
```

### Browser Use

```bash
export BROWSER_USE_API_KEY="your-api-key"
agent-browser -p browseruse open https://example.com
```

### Kernel

```bash
export KERNEL_API_KEY="your-api-key"
agent-browser -p kernel open https://example.com
```

Optional: `KERNEL_HEADLESS`, `KERNEL_STEALTH`, `KERNEL_TIMEOUT_SECONDS`, `KERNEL_PROFILE_NAME`

## Streaming (Browser Preview)

Stream viewport via WebSocket for live preview:

```bash
AGENT_BROWSER_STREAM_PORT=9223 agent-browser open example.com
```

Connect to `ws://localhost:9223` to receive frames and send input events.

## Example: Form Submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Example: Authentication with Saved State

```bash
# Login once
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later sessions
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```
