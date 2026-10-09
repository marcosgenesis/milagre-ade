const { checkClaude } = require("./claude.cjs");
const { checkCodex } = require("./codex.cjs");

// Settings › MCP: which accounts to check, and one account's check, capped so a hung CLI or server never leaves the
// tab spinning. The tab checks every account in parallel and groups the answers itself (@milagre/shared/mcp).

const PROVIDERS = new Set(["claude", "codex"]);
const TIMEOUT_PROBLEM = "Timed out after 30 s. Check the servers in a terminal.";

function createMcp({ accounts, routing, cwd, clientVersion, checkers = {}, timeoutMs = 30_000 }) {
  const run = { claude: checkers.claude ?? checkClaude, codex: checkers.codex ?? checkCodex };

  async function listed() {
    const snapshot = await accounts.list(false);
    return snapshot.providers.filter((group) => PROVIDERS.has(group.provider)).flatMap((group) => group.accounts.map((account) => ({ group, account })));
  }

  async function list() {
    return (await listed()).map(({ group, account }) => ({ provider: group.provider, accountId: account.id, label: account.email || account.label }));
  }

  async function check(provider, accountId) {
    const found = (await listed()).find(({ group, account }) => group.provider === provider && account.id === accountId);
    const base = { provider, accountId, label: found ? found.account.email || found.account.label : accountId };
    const answer = (problem, servers = []) => ({ ...base, problem, servers });
    if (!found) return answer("Account not found. Refresh and try again.");
    if (found.account.state === "signed-out") return answer("Not signed in. Sign in from Accounts.");
    const cli = await routing.forAccount(provider, accountId);
    if (cli.problem || !cli.command) return answer(cli.problem || "Install the provider CLI first.");
    const controller = new AbortController();
    let timer;
    const cap = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT_PROBLEM);
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([run[provider]({ command: cli.command, env: cli.env, cwd, clientVersion, signal: controller.signal }), cap]);
      return result === TIMEOUT_PROBLEM ? answer(TIMEOUT_PROBLEM) : answer(null, result);
    } catch (error) {
      return answer(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  return { accounts: list, check };
}

module.exports = { createMcp };
