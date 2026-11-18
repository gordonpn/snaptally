import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type Review = { readonly markdown: string; readonly sha: string };
type Comment = { readonly id: number; readonly body: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads the single review emitted by this action's provider snapshot. */
export function readReview(source: string, repository: string, number: number): Review {
  const records: unknown[] = source
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (records.length !== 1) throw new Error("Expected exactly one review output");
  const record = records[0];
  if (
    !object(record) ||
    record.type !== "review" ||
    !object(record.pr) ||
    record.pr.repo !== repository ||
    record.pr.number !== number ||
    typeof record.markdown !== "string" ||
    !record.markdown.trim() ||
    typeof record.pr.head_sha !== "string" ||
    !/^[a-f0-9]{40}$/u.test(record.pr.head_sha)
  ) {
    throw new Error("Review output has invalid revision or pull request identity");
  }
  return { markdown: record.markdown, sha: record.pr.head_sha };
}

/** Finds one matching action comment and adds the reviewed revision. */
export function labelReview(review: Review, values: unknown): Comment {
  if (!Array.isArray(values)) throw new Error("Invalid GitHub comment response");
  const marker = "\n\n<!-- pr-agent:review:full -->";
  const prefix = `Reviewed revision: ${review.sha}\n\n`;
  const candidates = values.filter(
    (value: unknown) =>
      object(value) &&
      object(value.user) &&
      value.user.login === "github-actions[bot]" &&
      typeof value.id === "number" &&
      typeof value.body === "string" &&
      (value.body.startsWith(prefix) ? value.body.slice(prefix.length) : value.body)
        .replace(marker, "")
        .trim() === review.markdown.trim(),
  );
  const unpublished = candidates.filter(
    (value: unknown) =>
      object(value) && typeof value.body === "string" && !value.body.startsWith(prefix),
  );
  const matches = unpublished.length ? unpublished : candidates;
  if (matches.length !== 1) throw new Error("Review publication is absent or ambiguous");
  const match: unknown = matches[0];
  if (!object(match) || typeof match.id !== "number" || typeof match.body !== "string") {
    throw new Error("Invalid matched review comment");
  }
  return {
    id: match.id,
    body: match.body.startsWith(prefix) ? match.body : `${prefix}${match.body}`,
  };
}

export async function labelPublishedReview(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.REVIEW_PR_NUMBER);
  const token = process.env.GITHUB_TOKEN;
  const output = process.env.REVIEW_OUTPUT_PATH;
  if (!repository || !Number.isSafeInteger(number) || number <= 0 || !token || !output) {
    throw new Error("Missing review publication configuration");
  }
  const review = readReview(readFileSync(output, "utf8"), repository, number);
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const comments: unknown[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) throw new Error(`Comment lookup failed with HTTP ${response.status}`);
    const values: unknown = await response.json();
    if (!Array.isArray(values)) throw new Error("Invalid GitHub comment response");
    comments.push(...values);
    if (values.length < 100) break;
  }
  const comment = labelReview(review, comments);
  const response = await fetch(
    `https://api.github.com/repos/${repository}/issues/comments/${comment.id}`,
    {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment.body }),
    },
  );
  if (!response.ok) throw new Error(`Comment labeling failed with HTTP ${response.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await labelPublishedReview();
