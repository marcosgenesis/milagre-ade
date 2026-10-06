# The host owns provider accounts

An Account is a saved Claude or Codex sign-in on one computer. Each provider has one selected Account across that host's Projects. Desktop and paired phones manage the same selection through the daemon. The existing CLI sign-in remains available as the default.

Added Accounts get private profiles under the host data directory's `accounts/` folder. `CLAUDE_CONFIG_DIR` or `CODEX_HOME` selects the profile for a process. The provider CLI owns login, credential storage and token refresh. Milagre stores only the profile ID, provider, display name and selected ID. Public account responses contain identity and status fields, never credentials or raw login output. A confined demo phone sees an empty list and cannot change accounts.

Sign-in runs on the computer and opens its browser. Accounts are added on desktop. A phone can re-authenticate an existing added Account or cancel its sign-in, but the browser callback must finish on the computer. Sign-in times out after five minutes. Finishing sign-in does not automatically change the selected Account.

Switching Accounts replaces an idle provider process on its next turn, resuming the saved Chat ID. Running turns and active subagents keep their existing process and credentials. History directories are shared between profiles; Codex also shares the original SQLite directory. Settings and instruction files are copied when a profile is created; skills and plugin directories are shared. Changing the selection never writes over the terminal's default login.

Model discovery, authentication status, Chat titles, handovers and other helper model calls use the selected Account too. Usage caches carry the account selection so failed reads cannot reuse another Account's numbers. Claude profile usage goes through the pinned SDK's experimental usage control method; unsupported versions report a usage error without falling back to the default credentials.

Remove removes a profile from the chooser, leaving its private directory and provider-managed credentials intact. This lets an in-flight reply finish and preserves shared history. The UI explains this behavior; removal is not credential revocation. Removing the selected Account switches the provider back to its connected CLI account.

Desktop account rows switch in one click and show Re-authenticate and Remove actions. Mobile uses compact tappable rows with a selection checkmark and a three-dot menu for those actions. Its Accounts screen does not offer Add account.
