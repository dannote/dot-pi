---
name: bird
description: X/Twitter CLI for posting tweets, reading threads, searching, and fetching news. Use when user asks to tweet, reply, read tweets, search X/Twitter, get mentions, view bookmarks, likes, followers, following, user timelines, or fetch trending news/topics.
---

# bird — X/Twitter CLI

Fast X CLI using GraphQL API with cookie auth.

## Install

```bash
# one-shot (no install)
bunx @steipete/bird whoami

# or install globally
bun add -g @steipete/bird
```

## Authentication

Credentials resolved in order:

1. CLI flags: `--auth-token`, `--ct0`
2. Env vars: `AUTH_TOKEN`, `CT0` (or `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`)
3. Browser cookies via `--cookie-source safari|chrome|firefox`

## Commands

### Post & Reply

```bash
bird tweet "Hello world"
bird tweet "With image" --media img.png --alt "description"
bird reply <tweet-id-or-url> "Reply text"
```

### Read

```bash
bird read <tweet-id-or-url>           # fetch tweet
bird <tweet-id-or-url>                # shorthand for read
bird thread <tweet-id-or-url>         # full conversation
bird replies <tweet-id-or-url>        # list replies
```

### Search & Mentions

```bash
bird search "query" -n 20
bird search "from:username" -n 10
bird mentions -n 5
bird mentions --user @handle -n 5
```

### Timelines

```bash
bird home -n 20                       # For You feed
bird home --following -n 20           # Following feed
bird user-tweets @handle -n 20        # user's tweets
bird list-timeline <list-id> -n 20
```

### Bookmarks & Likes

```bash
bird bookmarks -n 10
bird bookmarks --folder-id 123 -n 5
bird unbookmark <tweet-id-or-url>
bird likes -n 10
```

### News & Trending

```bash
bird news -n 10                       # all tabs
bird news --ai-only -n 10             # AI-curated only
bird news --sports -n 10              # sports tab
bird news --with-tweets -n 10         # include related tweets
```

Tab filters: `--for-you`, `--news-only`, `--sports`, `--entertainment`, `--trending-only`

### Social Graph

```bash
bird following -n 20
bird followers -n 20
bird following --user <userId> -n 10
```

### Account

```bash
bird whoami                           # show logged-in account
bird check                            # show available credentials
```

## Global Options

| Flag                | Description                              |
| ------------------- | ---------------------------------------- |
| `--json`            | JSON output                              |
| `--plain`           | No emoji, no color                       |
| `-n <count>`        | Number of results                        |
| `--all`             | Fetch all pages                          |
| `--max-pages <n>`   | Limit pagination                         |
| `--cursor <string>` | Resume from cursor                       |
| `--media <path>`    | Attach media (up to 4 images or 1 video) |
| `--alt <text>`      | Alt text for media                       |

## JSON Output Schema

Tweet objects:

- `id`, `text`, `author` (`{username, name}`), `authorId`
- `createdAt`, `conversationId`, `inReplyToStatusId`
- `replyCount`, `retweetCount`, `likeCount`
- `quotedTweet` (nested, depth via `--quote-depth`)

User objects (following/followers):

- `id`, `username`, `name`, `description`
- `followersCount`, `followingCount`, `isBlueVerified`

News objects:

- `id`, `headline`, `category`, `timeAgo`, `postCount`, `url`
- `tweets` (with `--with-tweets`)

## Notes

- Uses undocumented X GraphQL API — may break without notice
- Query IDs rotate; refresh with `bird query-ids --fresh`
- Rate limiting (429) may occur
