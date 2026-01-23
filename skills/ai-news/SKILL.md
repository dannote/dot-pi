---
name: ai-news
description: Fetch and curate AI news from X/Twitter list. Use when user asks for AI news, AI digest, what's happening in AI, or wants a summary of AI announcements, papers, and releases.
---

# AI News Digest

Fetch and curate important AI news from the user's X/Twitter AI list.

## Prerequisites

- `@dannote/bird-premium` package (official X API v2)
- AI list ID: `1894700501725229467`

## Workflow

1. Fetch tweets from the last 24 hours (use pagination to get all)
2. Filter out noise (marketing, challenges, hiring, retweets, emojis-only)
3. Categorize into: Releases, Papers, Insights, Tools
4. Extract actual announcement links from tweet text (t.co URLs to blogs, GitHub, arxiv)
5. Include tweet link as source

## Fetching Last 24 Hours

The list produces ~250-300 tweets per day. Use pagination to fetch all:

```bash
# First request (100 tweets max per request)
bunx --bun @dannote/bird-premium list-timeline 1894700501725229467 -n 100 --json

# Continue with cursor from previous response until createdAt < 24h ago
bunx --bun @dannote/bird-premium list-timeline 1894700501725229467 -n 100 --cursor <nextCursor> --json
```

**Stop fetching when** the oldest tweet's `createdAt` is older than 24 hours.

**Merge all tweets** from paginated responses, then filter by `createdAt` >= (now - 24h).

## Filtering Criteria

### Include (important)

- Model releases and announcements
- Research papers (arxiv links, paper titles)
- Tool/library releases with technical details
- Benchmark results
- Technical insights and analysis
- Infrastructure updates (vLLM, ComfyUI, MLX, etc.)
- API launches

### Exclude (noise)

- Marketing fluff ("excited to announce", "join us")
- Challenges and contests
- Hiring posts
- Retweets (text starting with "RT @")
- Single emoji or short reaction posts
- Partnership announcements without technical substance
- Repetitive product links spam

## Output Format

Organize into sections. Extract actual links from tweet text when available (GitHub, arxiv, blog posts). Include tweet as source.

```markdown
## Releases

**ProductName** (Company) — Brief description
Link: https://github.com/org/repo (or blog/arxiv link from tweet)
Source: https://x.com/username/status/ID

## Papers

**Paper Title** — One-line summary (Institution)
Link: https://arxiv.org/abs/XXXX
Source: https://x.com/username/status/ID

## Insights

**Topic** — Key finding or leak
Source: https://x.com/username/status/ID

## Tools

**Tool** — What it does
Link: https://example.com
Source: https://x.com/username/status/ID
```

## Example Usage

User: "What's happening in AI today?"

1. Fetch first page:
   ```bash
   bunx --bun @dannote/bird-premium list-timeline 1894700501725229467 -n 100 --json
   ```
2. Check oldest tweet's `createdAt` — if < 24h ago, fetch next page with `--cursor`
3. Repeat until oldest tweet is > 24h old
4. Merge all tweets, filter to last 24h by `createdAt`
5. Parse JSON, extract: `author.username`, `text`, `id`
6. Build source link: `https://x.com/{username}/status/{id}`
7. Extract t.co links from text, resolve to actual URLs when relevant
8. Filter noise, categorize, output curated digest
