# The host owns provider accounts

An Account is a saved Claude or Codex sign-in on one computer. Each provider has a computer default Account. A Project or named Link can independently select a saved Account for each provider, or use the computer default. Desktop and paired phones manage these host-local selections through the daemon. The existing CLI sign-in remains available as an explicitly selectable Account.

Added Accounts get private profiles under the host data directory's `accounts/` folder. `CLAUDE_CONFIG_DIR` or `CODEX_HOME` selects the profile for a process. The provider CLI owns login, credential storage and token refresh. Milagre stores the profile ID, provider, display name, computer-default IDs and per-scope assignment IDs in accounts/accounts.json. Omitted scope assignments inherit dynamically; an explicit `default` ID pins the connected CLI profile. Public account responses contain identity and status fields, never credentials or raw login output. A confined demo phone sees an empty list and cannot change accounts.

Sign-in runs on the computer and opens its browser. Accounts are added on desktop. A phone can re-authenticate an existing added Account or cancel its sign-in, but the browser callback must finish on the computer. Sign-in times out after five minutes. Finishing sign-in does not automatically change the selected Account.

Switching Accounts replaces an idle provider process on its next turn, resuming the saved Chat ID. Running turns and active subagents keep their existing process and credentials. History directories are shared between profiles; Codex also shares the original SQLite directory. Settings and instruction files are copied when a profile is created; skills and plugin directories are shared. Changing the selection never writes over the terminal's default login.

Model discovery, authentication status, Chat titles, Worktree names, handovers and Git text generation resolve the owning Project or Link Account. Viewing a different Project never changes routing. A Link uses its own assignment, including helpers in its owned member Worktrees; it does not inherit from a member Project. Usage caches carry the account selection so failed reads cannot reuse another Account's numbers. Claude profile usage goes through the pinned SDK's experimental usage control method; unsupported versions report a usage error without falling back to the default credentials.

Remove removes a profile from the chooser, leaving its private directory and provider-managed credentials intact. This lets an in-flight reply finish and preserves shared history. The UI explains this behavior; removal is not credential revocation. Removing the computer default switches that default back to the connected CLI account. Explicit Project and Link assignments retain the removed ID and show an unavailable account; new turns fail until the user chooses another Account or explicitly restores inheritance. Running replies retain their private profile.

Desktop account rows switch in one click and show Re-authenticate and Remove actions. Mobile uses compact tappable rows with a selection checkmark and a three-dot menu for those actions. Its Accounts screen does not offer Add account.

## Project Accounts settings

Accounts manages saved sign-ins and computer defaults. Project Accounts is a separate tab with a Project/Link selector, Project photos and stacked member photos for Links. Each provider offers Use computer default and the ready saved Accounts. Inherited selections show the resolved identity. Unavailable accounts cannot be selected; existing unavailable assignments stay visible rather than silently falling back. Mobile uses its native navigation header and back button, with a photo-based Project selector and native account menus.

Model/status caches are partitioned by effective account IDs. Usage storage and client state are also partitioned, and late responses from a previously viewed scope are ignored. Account changes notify connected desktop clients and paired phones without altering any viewed scope. A confined demo cannot read or mutate these assignments.
