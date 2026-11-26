---
name: trello
description: Read Trello cards and boards (description, checklists, comments, attachments and images, a board's lists and cards, search) with the person's own Trello token, which also sees boards they're only a guest on, such as Utvikling. Use when given a trello.com link, or asked about a Trello card, board or list. Read-only.
---

# Trello

Read Trello with `node ~/.claude/skills/trello/trello.mjs`. It only reads: never try to change
cards, move them or comment. If the person wants that, tell them what to change.

- A card from a link: `node ~/.claude/skills/trello/trello.mjs card <url>`. Its description,
  checklists, comments (oldest first) and attachments. Add `--images` when screenshots or other
  images matter: they're downloaded and their paths printed, so read them with the Read tool.
- A board: `node ~/.claude/skills/trello/trello.mjs board <url|name>`, every open list with its
  cards (`#number name — labels · members · due · url`). `--list <name>` narrows it to lists whose
  name has that in it; `--closed` takes archived cards too. A name can be part of the board's
  name, e.g. `board Utvikling`.
- What boards there are: `node ~/.claude/skills/trello/trello.mjs boards`.
- Search: `node ~/.claude/skills/trello/trello.mjs search <words> [--board <url|name>]`. Trello's
  search syntax works (`label:bug`, `list:"In progress"`, `is:open`, `@username`).

To explore, start from `boards` or `board <name>`, then open the cards that matter with `card`.
A card's description often links GitHub PRs and issues; `gh` reads those.

If it says it isn't logged in, ask the person to run
`! node ~/.claude/skills/trello/trello.mjs login` (it reads the key and token Herdr uses from
1Password, one Touch ID, and keeps them in the macOS Keychain), then try again. Don't run `login`
yourself.
