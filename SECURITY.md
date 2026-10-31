# Security policy

AI Village runs on your own computer and watches AI agents that can read your code and run
commands. Its security matters, so please report problems privately.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** button (Security tab → Advisories) on this repository.
Please do not open a public issue for security problems. Include what you found, how to reproduce
it, and which version or commit you tested. You should get a first reply within a week.

## What AI Village is designed to do

- **Stay on your network.** The hub accepts connections only from loopback and private (LAN)
  addresses and refuses public IPs. It is not built to be exposed to the internet: do not
  port-forward it, put it behind a public reverse proxy, or run it on a cloud VM with a public
  address.
- **Require a password.** The first visit from the hub's own computer sets the password (stored as
  a scrypt hash). Sessions use HttpOnly, SameSite=Strict cookies, and sign-in is rate-limited.
- **Keep secrets off disk in plain text and out of the browser.** API keys you store are encrypted
  (Windows DPAPI, or AES-256-GCM with an owner-only key file on macOS and Linux) and are never sent
  to the web page.
- **Collect as little as possible.** The agent hook reporter (`hooks/emit.mjs`) sends event names,
  session ids, project folder names, tool names and file names to `127.0.0.1` only. It never sends
  file contents or command arguments, and sends prompt text only if you turn on prompt previews.
- **Accept remote reports only with a token.** Agents on other machines need a per-agent bearer
  token; the hub stores only its hash. Hook ingest is loopback-only.

## Known limits

- Traffic on your LAN is plain HTTP unless you add a certificate (see the README). Anyone on the
  same network can see it; use a trusted home or office network.
- On macOS and Linux, secrets are protected by file permissions plus encryption with a local key,
  not by the OS keychain. Anyone who can read your user account's files can decrypt them.
- The Simulation Lab generates fake activity for demonstrations. It is always labeled and kept
  apart from real data, but do not rely on it for anything.

## Supported versions

Only the latest release on the default branch receives security fixes.
