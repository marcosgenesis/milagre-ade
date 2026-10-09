// Linear issue keys (ENG-12) and the ones a branch names. The key shape is the only part a client can't forge into a query.
const ISSUE_KEY = /^[a-z][a-z0-9]{0,6}-\d+$/i;
const KEY_IN_BRANCH = /(?:^|[/_-])([a-z][a-z0-9]{0,6}-\d+)(?=$|[/_-])/gi;

function isIssueKey(text) {
  return typeof text === "string" && ISSUE_KEY.test(text);
}

// `teams` holds the workspace's team keys in upper case. The first key in the branch whose team exists wins.
function issueKeyInBranch(branch, teams) {
  for (const match of String(branch ?? "").matchAll(KEY_IN_BRANCH)) {
    const key = match[1].toUpperCase();
    if (teams.has(key.split("-")[0])) return key;
  }
  return null;
}

module.exports = { isIssueKey, issueKeyInBranch };
