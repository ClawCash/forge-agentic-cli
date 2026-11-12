# The Agent Reviews hook has been replaced

Ratings in wallet search results now come from one wrapper that works the same in every agent:
https://reviews.forgeintel.co/WRAP.md.

If you added the earlier hook or plugin, remove it:

- **Claude Code, Codex, Cursor, Grok Build:** delete the entries that run `hook.mjs` from `~/.claude/settings.json`,
  `~/.codex/hooks.json`, `~/.cursor/hooks.json` or `~/.grok/hooks/agent-reviews.json`. Keep any other hooks.
- **Hermes:** run `hermes plugins disable agent-reviews`, then delete `~/.hermes/plugins/agent-reviews`.
- **OpenCode:** delete `~/.config/opencode/plugins/agent-reviews.js`.

Then delete `~/.config/agent-reviews/hook.mjs`. Keep `key` and `ratings.json` if you set up the wrapper.
