/** Authorizes supported maintainer commands against open, ready, same-repository PRs. */
export default async function authorize({ core, context, github }) {
  core.setOutput("allowed", "false");
  const event = context.payload;
  if (context.eventName === "issue_comment") {
    if (!/^\/(review|describe|improve|ask)(?:\s|$)/.test(event.comment.body)) return;
    if (!["OWNER", "MEMBER", "COLLABORATOR"].includes(event.comment.author_association)) return;
  }
  const number = event.pull_request?.number ?? event.issue?.number;
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  if (pr.state === "open" && !pr.draft && pr.head.repo?.full_name === repository) {
    core.setOutput("allowed", "true");
  }
}
