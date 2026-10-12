# agent-evaluation

Maintained by Aasav Suthar.

Manage GitHub PR review comments from the terminal and from AI coding agents.

PR review bots (Copilot, Cursor Bugbot, CodeRabbit, etc.) leave inline comments on your pull requests. agent-evaluation gives you a CLI to list, filter, reply to, and watch those comments, plus agent skills that automate the entire triage-fix-reply loop.

## Why

**`gh` CLI is fragile for review comments.** Agents frequently get the syntax wrong, fail to paginate, and can't reliably detect whether a comment has been replied to. agent-evaluation provides a single, purpose-built interface that handles all of this correctly.

**Bot reviews create a doom loop.** You fix one round of findings, push, and new comments appear. Fix those, push again, more comments. This cycle can eat hours. The included skills solve this with an integrated watcher that keeps fixing and replying until the bots go quiet.

**Works in cloud environments.** Most solutions rely on local tooling that isn't available in cloud or remote agent environments. agent-evaluation works everywhere, so you can kick off a session, let the agent resolve all findings autonomously, and come back to a clean PR.

## Install

### CLI (npm)

```bash
npm install -g agent-evaluation
```

### Agent Skills

Three skills are available, each as a slash command (no npm install required):

| Skill | What it resolves |
|-------|-----------------|
| `resolve-reviews` | All comments (human + bot) |
| `resolve-agent-reviews` | Bot comments only (Copilot, Cursor, etc.) |
| `resolve-human-reviews` | Human comments only |

Works with any agent that supports [Agent Skills](https://agentskills.io) (Claude Code, Cursor, Codex, etc.):

```bash
npx skills add . --skill resolve-agent-reviews
```

Replace `resolve-agent-reviews` with whichever skill you want. Skills use `npx agent-evaluation` at runtime, so the CLI is fetched automatically.

> You can also use both: install the CLI globally for direct terminal use, and a skill for the agent workflow.

## Authentication

The simplest method is the **GitHub CLI**. If you're logged in with `gh auth login`, agent-evaluation picks up the token automatically. No configuration needed.

For cloud/remote environments or HTTPS proxy setups, set `GITHUB_TOKEN` or `GH_TOKEN` directly. agent-evaluation includes [undici](https://github.com/nodejs/undici) `ProxyAgent` support and will route requests through `HTTPS_PROXY` automatically when set.

**Resolution order** (first match wins):

1. `GITHUB_TOKEN` environment variable
2. `GH_TOKEN` environment variable
3. `.env.local` in the repo root
4. `gh auth token` (GitHub CLI)

### Fork pull requests

Branch discovery keeps the head repository separate from the PR's base repository. It uses the branch push remote, `remote.pushDefault`, tracking remote, or `origin` (in that order), and looks for the current branch in configured GitHub repositories and the fork's parent/source repositories. The selected remote's push URL determines the head repository, including when its fetch URL points upstream. An upstream remote is not required. A single GitHub remote with another name also works.

`GH_REPO=organisation/project` restricts the target repository without changing the head owner. Use `GH_REPO=organisation/project agent-evaluation --pr 123` to select a PR explicitly, including from detached HEAD. Malformed `GH_REPO` values fail explicitly. If multiple open PRs match, or a matching PR has a deleted/inaccessible head repository that cannot be verified, the CLI asks for an explicit target instead of choosing one. Discovery uses the GitHub API and works with token authentication without requiring `gh`.

### Custom API host

Set `GITHUB_API_URL` to point agent-evaluation at a GitHub Enterprise host or any API-compatible server (useful for testing, recording, or routing through a local mediator). Defaults to `https://api.github.com`.

```bash
# GitHub Enterprise Server
GITHUB_API_URL=https://github.example.com/api/v3 agent-evaluation

# Local API-compatible server
GITHUB_API_URL=http://127.0.0.1:8080 agent-evaluation
```

GraphQL endpoint resolution: agent-evaluation uses `${GITHUB_API_URL}/graphql` by default. For GitHub Enterprise Server, where REST lives under `/api/v3` and GraphQL under `/api/graphql` on the same origin, the trailing `/api/v3` is rewritten to `/api/graphql` automatically. Set `GITHUB_GRAPHQL_URL` directly if you need full control over the GraphQL endpoint.

## CLI Usage

```bash
# List all review comments on the current branch's PR
agent-evaluation

# Only unresolved comments
agent-evaluation --unresolved

# Only unanswered bot comments
agent-evaluation --unanswered --bots-only

# Full detail for a specific comment (diff hunk + replies)
agent-evaluation --detail 12345678

# Reply to a comment
agent-evaluation --reply 12345678 "Fixed in abc1234"
agent-evaluation --reply 12345678 --body-file body.md

# Reply and record the outcome as a machine-readable verdict
agent-evaluation --reply 12345678 "Won't fix: intentional" --verdict wont_fix

# JSON output for scripting / AI agents
agent-evaluation --json

# Watch for new comments (polls every 30s, exits after 10 min idle)
agent-evaluation --watch --bots-only

# Target a specific PR (otherwise auto-detects from branch)
agent-evaluation --pr 42
```

Unknown options, unexpected arguments, and invalid numeric values fail before authentication or network requests. To pass an inline reply starting with a dash, put options first and use `agent-evaluation --reply 12345 -- "- Fixed the issue"`. Everything after `--` is literal text.

### Options

| Flag | Short | Description |
|------|-------|-------------|
| `--unresolved` | `-u` | Only unresolved/pending comments |
| `--unanswered` | `-a` | Only comments without any replies |
| `--reply <id> "msg"` | `-r` | Reply to a comment |
| `--body-file <path>` | | Read reply text from a UTF-8 file instead of a positional message |
| `--verdict <value>` | | Record the reply's outcome in a hidden marker (use with `--reply`) |
| `--resolve` | | Resolve the review thread after replying (use with `--reply`) |
| `--detail <id>` | `-d` | Full detail for a comment |
| `--pr <number>` | `-p` | Target a specific PR |
| `--json` | `-j` | JSON output |
| `--bots-only` | `-b` | Only bot comments |
| `--humans-only` | `-H` | Only human comments |
| `--ignore-author <login>` | | Exclude an author from listing and watching; repeat for multiple authors |
| `--expanded` | `-e` | Show full detail for each listed comment |
| `--watch` | `-w` | Poll for new comments |
| `--interval <sec>` | `-i` | Poll interval in seconds (default: 30) |
| `--timeout <sec>` | | Inactivity timeout in seconds (default: 600) |

To hide workflow status comments, use `agent-evaluation --ignore-author 'github-actions[bot]'`. Repeat the flag for multiple authors, including with `--watch`. Matching is case-insensitive and uses the full GitHub login, including `[bot]` when present. Excluded authors' top-level findings are hidden, but their replies remain visible as context in other authors' threads. Explicit `--detail` lookups and replies are unaffected. No authors are excluded by default.

## Agent Skills

The skills automate the full PR review resolution workflow:

1. Fetch unanswered comments (all, bot-only, or human-only depending on skill)
2. Evaluate each finding (true positive, false positive, actionable, etc.)
3. Fix real issues and run lint/type-check
4. Dismiss false positives with an explanation
5. Reply to every comment with the outcome
6. Watch for new comments and repeat until quiet
7. Report a summary of all actions taken

### Skill behavior

- **True positives / actionable feedback** get fixed and replied with `Fixed in {commit}`
- **False positives** get replied with `Won't fix: {reason}`
- **Uncertain findings** prompt the user for guidance
- All fixes are batched into a single commit before polling begins
- Watch mode loops until no new comments appear for 10 minutes

## How It Works

### Comment types

agent-evaluation fetches three types of GitHub PR comments:

| Type | Label | Description |
|------|-------|-------------|
| Review comment | `CODE` | Inline comment attached to a specific line |
| Issue comment | `COMMENT` | General PR-level comment |
| Review | `REVIEW` | Review summary (approved, changes requested) |

### Meta-comment filtering

Bot review bodies (`REVIEW` type) are always filtered out since actionable findings come through as inline comments. Additionally, these bot issue comments are filtered:

| Bot | What's filtered |
|-----|----------------|
| Vercel | Deployment status (`[vc]:...`) |
| Supabase | Branch status (`[supa]:...`) |
| Cursor Bugbot | Review summary ("Cursor Bugbot has reviewed your changes...") |
| Copilot | PR review summary ("Pull request overview") |
| CodeRabbit | Walkthrough, summary, and "review skipped" comments |
| Sourcery | Reviewer's guide and PR summary |
| Codacy | Analysis summary and coverage summary |
| SonarCloud | Quality Gate pass/fail summary |
| Gemini Code Assist | "Summary of Changes" issue comment |

### Reply status

Each comment displays its reply status:

| Status | Meaning |
|--------|---------|
| `no reply` | No one has replied |
| `replied` | A human has replied |
| `bot replied` | Only bots have replied |

### Reply verdicts

`--verdict` appends a hidden HTML comment to the reply, for example `<!-- agent-evaluation verdict=wont_fix -->`. GitHub does not render it, so reviewers only see the message. Accepted values are `fixed`, `wont_fix`, `already_addressed`, `discussed`, and `skipped`; anything else is rejected before posting.

When listing comments, each reply carries a `verdict` field in `--json` output (`null` when the reply has no marker), and `--detail` / `--expanded` show it as `[verdict: ...]` next to the reply author. This turns every triage decision into a label that can be counted later, for example to measure how often a review bot's findings are real.

### Watch mode

Polls the GitHub API at a configurable interval and reports new comments as they appear. Outputs both formatted text and JSON for AI agent consumption. Exits automatically after a configurable inactivity timeout (default: 10 minutes).

Reply files preserve Markdown and newlines exactly. For multiline or complex replies, write the text to a file and pass `--body-file body.md` to avoid shell quoting and command substitution. Both absolute and relative paths are supported; relative paths are resolved from the current directory. Prefer uniquely named temporary files outside the repository so later commits cannot accidentally include reply text. Use either a positional message or `--body-file`, not both; empty or whitespace-only replies are rejected. The flag works with `--resolve` and `--json`.

## Changelog

### 1.2.0 (October 12, 2026)

- Renamed the package and command from `agent-reviews` to `agent-evaluation`.
- Record each reply's outcome with `--verdict` (`fixed`, `wont_fix`, `already_addressed`, `discussed`, `skipped`) in a hidden marker.
- Read verdicts back as a `verdict` field on replies in `--json`, and as `[verdict: ...]` in `--detail` and `--expanded`.
- All three skills pass the matching `--verdict` on every reply.

### 1.1.0 (September 10, 2026)

- Read exact UTF-8 reply text with `--body-file`, without shell command substitution.
- Reject unknown flags and invalid arguments before posting; use `--` for replies beginning with a dash.
- Discover fork PRs across upstream repositories, separate push URLs, and GitHub Enterprise hosts.
- Exclude selected authors from listing and watching with repeatable `--ignore-author`.
- Reduce duplicate replies with fresh reply checks and watcher-startup reconciliation in all three skills.
- Update development dependencies to Vitest 5 and refresh website dependencies and audit fixes.

Development tests now require Node.js 22.12+, 24, or 26+ as supported by Vitest 5. CLI runtime support remains Node.js 18+.

### 1.0.2

- GitHub Enterprise Server support via `GITHUB_API_URL` env var (also works for local API-compatible servers used in testing). REST and GraphQL endpoints both honor it, with GHES `/api/v3` automatically rewritten to `/api/graphql`. Optional `GITHUB_GRAPHQL_URL` for unusual setups.
- Gemini Code Assist meta-comment filtering: the bot's `## Summary of Changes` issue comment is now dropped, while inline severity-badged findings are preserved.

### 1.0.0

**Three skills instead of one.** The single `agent-reviews` skill has been split into three, each tailored for different workflows:

- `resolve-reviews` resolves all comments (human + bot)
- `resolve-agent-reviews` resolves bot comments only
- `resolve-human-reviews` resolves human comments only

**Thread resolution.** The new `--resolve` flag marks GitHub review threads as resolved after replying. Uses the GraphQL `resolveReviewThread` mutation. Works with `--reply` in any argument order.

**Expanded bot support.** Added detection and meta-comment filtering for CodeRabbit, Sourcery, Codacy, SonarCloud/SonarQube Cloud, and Copilot PR reviewer, in addition to the existing Cursor Bugbot, Vercel, and Supabase filters.

**Agent-harness universal.** Skills now work with any agent that supports [Agent Skills](https://agentskills.io) (Claude Code, Cursor, Codex, etc.), not just Claude Code.

**Watch mode improvements.** The watcher now exits immediately when new comments are found (with a 5s grace period for batch posts), designed for loop-based workflows where the agent processes comments and restarts the watcher.

**New CLI options:**

- `--resolve` resolves the review thread after replying (use with `--reply`)
- `--expanded` / `-e` shows full detail (body, diff hunk, replies) for each comment in list mode

**Bug fixes:**

- `--json --resolve` no longer emits plain-text status messages to stdout

**Cloud and proxy support:**

- `GH_TOKEN` environment variable support (in addition to `GITHUB_TOKEN`)
- `GH_REPO` environment variable for targeting repos in detached environments
- Curl-based HTTP fallback for environments without native fetch/undici
- Curl requests include timeouts (10s connect, 60s max)

**Smarter filtering.** Bot review bodies (summaries listing inline findings) are now automatically excluded, since actionable findings always come through as inline comments. Reply comments posted by agent-reviews itself (`> Re: comment ...`) are also filtered to avoid noise.

**Simplified architecture.** Skills now invoke `npx agent-reviews` at runtime instead of bundling their own scripts, reducing the package from ~4000 lines of duplicated code to a single CLI entry point. Skills no longer run redundant startup commands (version check, branch detection, PR lookup), relying on the CLI's own error handling instead.

## License

MIT. Copyright (c) 2026 Aasav Suthar for modifications to this project.

Includes code from [pbakaus/agent-reviews](https://github.com/pbakaus/agent-reviews), copyright (c) 2025 Paul Bakaus, under the MIT license. See [LICENSE](LICENSE) for the full terms and retained copyright notices.
