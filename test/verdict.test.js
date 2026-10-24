import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { parseArgs, prepareReply } = require("../bin/agent-evaluation.js");

function run(args) {
  return spawnSync(process.execPath, ["bin/agent-evaluation.js", ...args], {
    encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "", GH_TOKEN: "", PATH: "" },
  });
}

describe("--verdict option", () => {
  it.each(["fixed", "wont_fix", "already_addressed", "discussed", "skipped"])(
    "accepts %s with --reply in any order",
    (verdict) => {
      expect(parseArgs(["--reply", "123", "Done", "--verdict", verdict]).verdict).toBe(verdict);
      expect(parseArgs(["--verdict", verdict, "--reply", "123", "Done"]).verdict).toBe(verdict);
    }
  );

  it("defaults to no verdict", () => {
    expect(parseArgs(["--reply", "123", "Done"]).verdict).toBe(null);
  });

  it.each([
    [["--reply", "123", "Done", "--verdict", "false_positive"], "--verdict must be one of"],
    [["--reply", "123", "Done", "--verdict"], "--verdict requires"],
    [["--reply", "123", "Done", "--verdict", "fixed", "--verdict", "skipped"], "only be specified once"],
    [["--verdict", "fixed"], "--verdict requires --reply"],
  ])("rejects %j before authentication", (args, message) => {
    const result = run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain("GitHub token");
    expect(result.stdout).toBe("");
  });
});

describe("verdict marker in reply text", () => {
  it("appends a hidden marker after the message", () => {
    const options = parseArgs(["--reply", "123", "Won't fix: intentional", "--verdict", "wont_fix"]);
    prepareReply(options);
    expect(options.replyMessage).toBe("Won't fix: intentional\n\n<!-- agent-evaluation verdict=wont_fix -->");
  });

  it("leaves the message untouched without a verdict", () => {
    const options = parseArgs(["--reply", "123", "Fixed in abc1234"]);
    prepareReply(options);
    expect(options.replyMessage).toBe("Fixed in abc1234");
  });

  it("keeps body file content exact before the marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-"));
    const file = join(dir, "body.md");
    const body = "Fixed in abc1234\n\n```js\n$(not run)\n```\n";
    writeFileSync(file, body);
    try {
      const options = parseArgs(["--reply", "123", "--body-file", file, "--verdict", "fixed"]);
      prepareReply(options);
      expect(options.replyMessage).toBe(`${body}\n\n<!-- agent-evaluation verdict=fixed -->`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("reading verdicts back", () => {
  const { processComments } = require("../lib/comments.js");
  const { formatDetailedComment } = require("../lib/format.js");

  function raw(...replyBodies) {
    const base = { path: "a.js", line: 1, created_at: "2026-10-01T00:00:00Z", html_url: "u" };
    return {
      reviewComments: [
        { ...base, id: 1, user: { login: "coderabbitai[bot]" }, body: "Possible null deref" },
        ...replyBodies.map((body, i) => ({ ...base, id: 10 + i, in_reply_to_id: 1, user: { login: "dev" }, body })),
      ],
      issueComments: [],
      reviews: [],
    };
  }

  it("exposes the verdict on each reply and keeps the marker out of the body", () => {
    const [comment] = processComments(raw(
      "Won't fix: guarded upstream\n\n<!-- agent-evaluation verdict=wont_fix -->",
      "Plain reply",
    ));
    expect(comment.replies.map((r) => r.verdict)).toEqual(["wont_fix", null]);
    expect(comment.replies[0].body).toBe("Won't fix: guarded upstream");
  });

  it("ignores markers with unknown values or from other tools", () => {
    const [comment] = processComments(raw(
      "x <!-- agent-evaluation verdict=lgtm -->",
      "y <!-- other-tool verdict=fixed -->",
    ));
    expect(comment.replies.map((r) => r.verdict)).toEqual([null, null]);
  });

  it("shows the verdict in detailed output", () => {
    const [comment] = processComments(raw("Fixed in abc\n\n<!-- agent-evaluation verdict=fixed -->"));
    expect(formatDetailedComment(comment)).toMatch(/\[10\] dev \(.*\) \[verdict: fixed\]:/);
  });
});
