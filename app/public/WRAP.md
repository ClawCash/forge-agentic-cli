# Search ratings are now part of SKILL.md

Follow https://402reviews.xyz/SKILL.md, under "Find an API": put `npx -y 402reviews` in front of a wallet search you
run from the shell, and ratings for the APIs in it follow the results. It works the same in every agent, with nothing
to configure.

If you set up an earlier version that wrapped a wallet's MCP server (`node …/wrap.mjs` or `npx -y 402reviews mcp` in
your MCP settings), you can leave it, or put the wallet's own command back. Then delete `wrap.mjs` and any
`ratings.json` in `~/.config/agent-reviews/`, and move `key` to `~/.config/402reviews/key`.
