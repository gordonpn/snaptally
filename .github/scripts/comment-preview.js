/**
 * Posts or updates a sticky comment on the pull request with Cloudflare Pages preview details.
 *
 * @param {object} params
 * @param {any} params.github
 * @param {any} params.context
 */
export default async function commentPreview({ github, context }) {
  const marker = "<!-- cloudflare-pages-preview-deployment -->";
  const aliasUrl = process.env.ALIAS_URL || "";
  const deploymentUrl = process.env.DEPLOYMENT_URL || "";
  const commitSha = context.payload.pull_request.head.sha.substring(0, 7);
  const headRef = context.payload.pull_request.head.ref;

  let body = `${marker}\n### Cloudflare Pages Preview Deployed\n\n`;
  if (aliasUrl) {
    body += `- **Preview URL:** [${aliasUrl}](${aliasUrl})\n`;
  }
  if (deploymentUrl && deploymentUrl !== aliasUrl) {
    body += `- **Deployment URL:** [${deploymentUrl}](${deploymentUrl})\n`;
  }
  body += `- **Commit:** ${commitSha}\n`;
  body += `- **Branch:** ${headRef}\n`;

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number,
  });

  const existing = comments.find(
    (c) =>
      c.user?.type === "Bot" &&
      (c.user?.login === "github-actions[bot]" || c.user?.login === "github-actions") &&
      c.body?.includes(marker),
  );

  if (existing) {
    await github.rest.issues.updateComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      comment_id: existing.id,
      body,
    });
    return;
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number,
    body,
  });
}
