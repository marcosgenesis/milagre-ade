const { checkClaude } = require("./claude.cjs");
const { checkCodex } = require("./codex.cjs");

// Settings › MCP: which accounts to check, and one account's check, capped so a hung CLI or server never leaves the
// tab spinning. The tab checks every account in parallel and groups the answers itself (@milagre/shared/mcp).

const PROVIDERS = new Set(["claude", "codex"]);
// The caller waits longer than this cap (45 s): SLOW_METHODS in apps/daemon/src/client.cjs and MCP_CALLS in apps/mobile/src/client.ts.
// Keep them above the cap so a timeout arrives as this answer, never as a transport error.
const TIMEOUT_PROBLEM = "Timed out after 30 s. Check the servers in a terminal.";

function createMcp({ accounts, routing, cwd, clientVersion, checkers = {}, timeoutMs = 30_000 }) {
  const run = { claude: checkers.claude ?? checkClaude, codex: checkers.codex ?? checkCodex };

  async function listed() {
    // The cheap snapshot: it inspects nothing, so a first open never waits on identity checks.
    const snapshot = await accounts.snapshot();
    return snapshot.providers.filter((group) => PROVIDERS.has(group.provider)).flatMap((group) => group.accounts.map((account) => ({ group, account })));
  }

  async function list() {
    return (await listed()).map(({ group, account }) => ({ provider: group.provider, accountId: account.id, label: account.email || account.label }));
  }

  async function check(provider, accountId) {
    const controller = new AbortController();
    let timer;
    const cap = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMEOUT_PROBLEM);
      }, timeoutMs);
    });
    let base = { provider, accountId, label: accountId };
    const answer = (problem, servers = []) => ({ ...base, problem, servers });
    // The cap starts here, so it bounds the account lookup and the CLI lookup as well as the checker.
    const work = async () => {
      const found = (await listed()).find(({ group, account }) => group.provider === provider && account.id === accountId);
      if (!found) return answer("Account not found. Refresh and try again.");
      base = { provider, accountId, label: found.account.email || found.account.label };
      if (found.account.state === "signed-out") return answer("Not signed in. Sign in from Accounts.");
      const cli = await routing.forAccount(provider, accountId);
      if (cli.problem || !cli.command) return answer(cli.problem || "Install the provider CLI first.");
      const servers = await run[provider]({
        command: cli.command,
        env: cli.env,
        cwd,
        clientVersion,
        signal: controller.signal,
        timeoutMs: Math.max(0, timeoutMs - 5000),
      });
      return answer(null, servers);
    };
    try {
      const result = await Promise.race([work(), cap]);
      return result === TIMEOUT_PROBLEM ? answer(TIMEOUT_PROBLEM) : result;
    } catch (error) {
      return answer(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  return { accounts: list, check };
}

module.exports = { createMcp };
