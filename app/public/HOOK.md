# The Agent Reviews hook has been replaced

Ratings in wallet search results now come from one wrapper that works the same in every agent:
https://402reviews.xyz/SKILL.md, under "Find an API".

If you added the earlier hook or plugin, remove it:

- **Claude Code, Codex, Cursor, Grok Build:** delete the entries that run `hook.mjs` from `~/.claude/settings.json`,
  `~/.codex/hooks.json`, `~/.cursor/hooks.json` or `~/.grok/hooks/agent-reviews.json`. Keep any other hooks.
- **Hermes:** run `hermes plugins disable agent-reviews`, then delete `~/.hermes/plugins/agent-reviews`.
- **OpenCode:** delete `~/.config/opencode/plugins/agent-reviews.js`.

Then delete `~/.config/agent-reviews/hook.mjs`. Agent Reviews is now 402reviews: move `key` to `~/.config/402reviews/key`.
