---
name: twit
description: Use the local twit CLI mailbox to check, read, send, and reply to asynchronous messages among a person and CLI agents, inspect the available names, and manage archive state. Do not use for email, social-media posting, or waking and running another agent.
---

# twit

Use `twit` as a local, SQLite-backed mailbox. Messages and reply relationships are immutable. The user controls when participants check messages and perform work; twit does not wake recipients, run agents, assign roles, or prove that a recipient acted.

These instructions target the CLI with `--from` / `--to` / `--as` and JSON `schema_version: 2`.

## Establish context and choose names

- Confirm the executable with `command -v twit`. This CLI requires Node.js 24 or later; if execution fails, inspect the Node version used by that invocation. Report a missing or incompatible installation instead of silently installing, rebuilding, or changing shared configuration.
- Prefer `--json`. Check both the exit status and JSON `ok`. Run `twit contacts --json` to obtain `data.contacts`, an ordered array of names from the current process's `TWIT_CONTACTS`.
- If the installed CLI returns `schema_version: 1`, it has not yet adopted this contract. Report the mismatch before issuing v2 commands; do not reintroduce the removed registration workflow to make them succeed.
- Use names explicitly supplied by the user, exactly as given. Names such as `codex` and `claude` identify senders and recipients, not roles. Do not add session suffixes or replace a supplied name with a product-name variant.
- If the user has not supplied the sender or mailbox name, choose the unique entry that clearly matches Codex's product name. If there is no clear match or more than one, ask the user. The recipient comes from the user's instruction; do not infer it from a role.
- `TWIT_CONTACTS` is inherited per process. A shell configuration change does not automatically update already-running agent sessions. If a requested name is absent, show the names returned by that invocation and ask for the missing choice or configuration; do not silently edit the list.
- `send` takes `--from` and `--to`. Inbox, sent, read, reply, thread, archive, and unarchive take `--as` to identify the relevant mailbox. This is a mailbox selector, not authentication or a role. `contacts` needs no `--as`; do not combine `send --from` with `--as`.
- `TWIT_ACTOR`, `--actor`, `whoami`, and `contacts add` are removed. Do not use them. `ACTOR_NOT_CONFIGURED` (exit 8) now means missing `TWIT_CONTACTS` or `--as`; use the error's setup guidance. `NOT_FOUND` (exit 3) for a name includes the current list in `details.contacts`.
- Respect `TWIT_HOME` when set; otherwise twit uses `~/.twit/twit.db`. Do not inspect or modify the mailbox SQLite database directly to bypass name selection or CLI errors.

## Inspect and read

At the start of a twit-handling task, inspect the selected default inbox. These examples assume the selected name is `codex`:

```sh
twit inbox --as codex --json
twit thread M-001 --as codex --no-body --json
twit read M-004 M-005 --as codex --json
twit read --unread --as codex --json
```

- The default inbox includes unread and already-read messages that are not archived. Use it at the start and end of handling so unfinished work is visible. Use `inbox --unread` for new arrivals during an ongoing session. `--unread`, `--archived`, and `--all` are mutually exclusive inbox filters.
- `inbox`, `sent`, and `thread` do not change read or archive state. Inbox, sent, and `thread --no-body` return `preview` and `body_length` without the full body. The preview is the first nonblank trimmed line, truncated after 80 code points with an ellipsis when longer; Markdown is not interpreted.
- Reading marks newly read received messages as read. A sender reading their sent message does not change or reveal the recipient's read state. Reading an archived message by ID does not unarchive it.
- Every `read` response, including a single ID, uses `data.messages`. Each item contains the full message and its own `marked_read`. Do not use the old `data.message` or top-level `data.marked_read` for `read`; `send` and `reply` still use `data.message`.
- Explicit IDs are returned in input order. `read --unread` reads all unarchived unread messages in ascending creation sequence; an empty result is `messages: []` and success. It cannot be combined with IDs. Duplicate IDs and a call with neither IDs nor `--unread` are input errors.
- Batch reads are all-or-nothing: missing messages, insufficient access, or a database update failure leave every target's read state unchanged. An error is not a partially successful read.
- If long bodies are likely, inspect previews or `thread --no-body` and read only the needed IDs. Do not replace the initial default-inbox check with `read --unread`, which misses already-read unfinished messages.
- Read and archive state are mailbox organization, not acceptance or completion. A request to inspect or summarize alone does not authorize replying or archiving.

## Send and reply

Use the resolved names and enough context for another participant to act without this conversation:

```sh
twit send --from codex --to claude --subject "Implementation review" \
  --body-file /absolute/path/request.md --request-id implementation-review-v1 --json

twit reply M-007 --as codex --body-file /absolute/path/result.md \
  --request-id implementation-review-result-v1 --json
```

- Prefer `--body-file` for multiline content, Markdown, quotes, and shell metacharacters. `--body-file -` reads stdin. Use `--body` for short, shell-safe text.
- Requests should give the absolute work location, exact scope, constraints, and desired reply. Results should give the findings or changes, repository and full commit ID when applicable, verification, and remaining uncertainty. State whether a reply is needed, such as "회신 불필요" or "확인 답장 요청".
- Use `reply` when responding to an existing message. It preserves the subject and thread and derives the recipient from the original message and `--as`; do not supply another `--to` or start an unrelated conversation.
- For an uncertain send or reply, retry only with the same `--request-id` and identical content. A matching retry returns the existing message with `replayed: true`; different content under that key fails. Without a request ID, every retry creates a new message, so never retry blindly after ambiguous output.
- Sending only stores the message. Report storage separately from recipient action; any request to start or wake another agent is a separate task outside this skill. Correct a sent mistake with a follow-up in the same thread.

## Finish processing

When the task authorizes handling messages, reply where required and archive fully processed received messages using `twit archive <id> --as <name> --json`. Use `unarchive` with the same selector when requested. These commands change archive state only; leave messages unarchived while work, a reply, or user direction remains pending.

Before reporting completion, inspect `twit inbox --as <name> --json` again. Report sent or replied message IDs, whether each result was replayed, and any remaining work. Do not add polling, hooks, automatic wakeups, or unsolicited follow-up runs.
