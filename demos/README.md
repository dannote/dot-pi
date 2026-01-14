# Demo Recordings

Automated terminal recordings for dot-pi extensions using [asciinema](https://asciinema.org) and [expect](https://linux.die.net/man/1/expect).

## Prerequisites

```bash
brew install asciinema expect
```

## Recording

Record all demos:

```bash
./record-all.sh
```

Or record a single demo:

```bash
expect tapes/codesearch.expect
```

## Tapes

| Tape                | Description                                       |
| ------------------- | ------------------------------------------------- |
| `codesearch.expect` | Search GitHub code for useEffect cleanup patterns |
| `websearch.expect`  | Search the web for Bun 1.3 features               |
| `webfetch.expect`   | Fetch and summarize bun.sh                        |

## Playback

```bash
asciinema play recordings/codesearch.cast
```

## Upload

```bash
asciinema upload recordings/codesearch.cast
```

Then embed in README with:

```markdown
[![asciicast](https://asciinema.org/a/YOUR_ID.svg)](https://asciinema.org/a/YOUR_ID)
```
