---
name: ai-news
description: Fetch and curate AI news from X/Twitter list. Use when user asks for AI news, AI digest, what's happening in AI, or wants a summary of AI announcements, papers, and releases.
---

# AI News Digest

Fetch and curate important AI news from the user's X/Twitter AI list.

## Prerequisites

- `bird` skill for X/Twitter CLI access
- AI list ID: `1894700501725229467`

## Workflow

1. Fetch recent tweets from the AI list (see bird skill for commands)
2. Filter out noise (marketing, challenges, hiring, retweets, emojis-only)
3. Categorize into: Releases, Papers, Insights, Tools
4. Extract actual announcement links from tweet text (t.co URLs to blogs, GitHub, arxiv)
5. Include tweet link as source

## Commands

```bash
# Fetch 200 tweets as JSON
bunx @steipete/bird list-timeline 1894700501725229467 -n 200 --json
```

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

1. Run: `bunx @steipete/bird list-timeline 1894700501725229467 -n 200 --json`
2. Parse JSON, extract: `author.username`, `text`, `id`
3. Build source link: `https://x.com/{username}/status/{id}`
4. Extract t.co links from text, resolve to actual URLs when relevant
5. Filter and categorize
6. Output curated digest
