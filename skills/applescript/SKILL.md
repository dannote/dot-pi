---
name: applescript
description: AppleScript and JXA automation for macOS. Use when user asks to automate apps, control system, run AppleScript/osascript, or integrate with macOS applications.
---

# AppleScript & JXA Automation

Expert in AppleScript and JavaScript for Automation (JXA) for macOS system scripting.

## Execution Methods

```bash
# AppleScript one-liner
osascript -e 'tell application "Finder" to activate'

# AppleScript file
osascript script.scpt

# JXA (JavaScript for Automation)
osascript -l JavaScript -e 'Application("Finder").activate()'

# Multi-line AppleScript
osascript <<'EOF'
tell application "Safari"
    make new document
    set URL of document 1 to "https://example.com"
end tell
EOF
```

## Common Patterns

### Application Control

```applescript
-- Activate app
tell application "Safari" to activate

-- Get frontmost app
tell application "System Events" to get name of first process whose frontmost is true

-- List windows
tell application "System Events"
    tell process "Safari"
        get name of every window
    end tell
end tell

-- Click UI elements
tell application "System Events"
    tell process "Safari"
        click button 1 of window 1
    end tell
end tell
```

### File Operations

```applescript
-- Open file
tell application "Finder"
    open file "Macintosh HD:Users:user:file.txt"
end tell

-- Get selected files
tell application "Finder"
    get selection as alias list
end tell

-- Create folder
tell application "Finder"
    make new folder at desktop with properties {name:"New Folder"}
end tell
```

### Notifications & Dialogs

```applescript
-- Display notification
display notification "Task complete" with title "Script" sound name "default"

-- Dialog with buttons
display dialog "Continue?" buttons {"Cancel", "OK"} default button "OK"

-- Choose file
choose file with prompt "Select a file:"

-- Choose folder
choose folder with prompt "Select a folder:"
```

### Shell Integration

```applescript
-- Run shell command (use quoted form for safety!)
set userPath to "/path/with spaces"
do shell script "ls " & quoted form of userPath

-- Get command output
set result to do shell script "date '+%Y-%m-%d'"

-- Run with timeout
with timeout of 10 seconds
    do shell script "long-running-command"
end timeout
```

### JXA Examples

```javascript
// Activate app
Application("Safari").activate();

// Get frontmost app
Application("System Events").processes.whose({ frontmost: true })[0].name();

// Display dialog
const app = Application.currentApplication();
app.includeStandardAdditions = true;
app.displayDialog("Hello!", { buttons: ["OK"], defaultButton: "OK" });

// Run shell command
app.doShellScript("ls -la");

// Work with files
const finder = Application("Finder");
const desktop = finder.desktop;
finder.make({ new: "folder", at: desktop, withProperties: { name: "Test" } });
```

## Security Rules

**ALWAYS use `quoted form of` for shell arguments:**

```applescript
-- BAD: injection risk
do shell script "echo " & userInput

-- GOOD: safe
do shell script "echo " & quoted form of userInput
```

**NEVER execute with administrator privileges unless explicitly requested:**

```applescript
-- Requires user confirmation and password
do shell script "..." with administrator privileges
```

**ASK user before accessing these sensitive apps:**

- Keychain Access, 1Password, Bitwarden (passwords)
- Terminal, iTerm (can execute arbitrary commands)
- Mail, Messages (private communications)
- Banking/financial apps
- System Preferences/Settings

**ASK user before these high-risk operations:**

- Reading UI elements from apps (can expose sensitive data on screen)
- Sending keystrokes (`keystroke` command)
- Clicking UI elements in unfamiliar apps
- Accessing clipboard contents
- Taking screenshots

**NEVER do these without explicit user request:**

- `keystroke` passwords or sensitive data
- Read text from password fields
- Access browser cookies/sessions
- Send emails or messages on user's behalf

## Debugging

```bash
# Check if app is scriptable
sdef /Applications/Safari.app | head -50

# Open Script Editor dictionary
open -a "Script Editor" /Applications/Safari.app

# Test script interactively
osascript -i
```

## Common Issues

| Issue                   | Solution                                                       |
| ----------------------- | -------------------------------------------------------------- |
| "Not authorized"        | Grant permissions in System Preferences → Privacy → Automation |
| "Application not found" | Use exact app name from `/Applications`                        |
| "Can't get window 1"    | App may have no windows open                                   |
| Timeout                 | Use `with timeout of N seconds` block                          |
| Quotes in strings       | Escape with `\"` or use `quoted form of`                       |
