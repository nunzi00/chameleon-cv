---
title: Several people, one workspace
---
# Several people, one workspace

A workspace can hold **users**: you and whoever else you like, each with their own sources, generated CVs and
history, kept apart.

```
chamaleon-cv-lucas/
  cv.toml          ← shared
  themes/          ← shared
  usuarios/
    lucas/         ← data/sources, output, import, offers, revisiones…
    invitado1/
```

The whole idea fits in one sentence: **a user is a workspace inside the workspace**. Everything you already
know how to do works the same inside one; only the root changes.

## A user is not an account

::: warning There are no passwords, and that is deliberate
A user **separates work, it does not protect it**. Anyone with the URL and the `cv serve` token can open any of
the users, and anyone with a terminal can read their files directly.

Chameleon CV runs on your machine, on `127.0.0.1`. Putting passwords on top of files your own operating system
hands over without asking would create a false sense of security, which is worse than none. If you need real
isolation, use it where it exists: two system accounts, two directories, two `cv serve`.
:::

What it *is* for: lending someone the tool without showing them your work history, and keeping their CV from
getting mixed with yours.

## Creating the first one

```bash
cv users create invitado1
```

It is seeded with the same sample dataset as `cv init`, so it compiles right away. `--empty` creates it bare.

In the web interface it is the **Usuario** button in the header, which is always there — including when there
are no users yet.

## Working as someone

```bash
cv --user invitado1 build
cv --user invitado1 generate-cv -s backend

export CHAMELEON_USER=invitado1   # or set it for the whole session
```

The flag goes **before** the command. In the web interface, use the header selector; the choice is remembered
in that browser, and the header always shows who you are working as.

::: tip There is no "active user" stored on disk
In the terminal the user is always explicit. Invisible state deciding whose CV you just generated is the kind
of thing you find out about late and badly.
:::

## If you pick nobody

- If the root still has its own sources, that is what is used — it always was a valid workspace — but you are
  told that there are users and you have not chosen one.
- If the root no longer has sources, the command stops and lists the users.

## Turning what you already have into the first user

If your CV has lived in the root for months and now you want to add someone:

```bash
cv users create lucas --adopt
```

This **moves** what is yours (`data`, `output`, `import`, `offers`, `revisiones`) into `usuarios/lucas/`, one
directory rename at a time: not a single byte is rewritten, and nothing is deleted. `cv.toml` and `themes/`
stay in the root, because they belong to the workspace and everyone shares them.

## What is shared

| | |
|---|---|
| Sources, artifact, outputs, history, drafts, offers, reviews | per user |
| `themes/` (installed CV themes) | shared |
| `cv.toml` | the root sets the defaults; the user's overrides it **key by key** |
| Remote provider keys and co-pilot cache | shared (they live outside the workspace) |

A `usuarios/<id>/cv.toml` with just this changes that person's theme and nothing else:

```toml
[theme]
name = "cinta"
```

Co-pilot and server settings (`[llm]`, `[serve]`) are always written to the root `cv.toml`, including from the
**Ajustes** screen: they configure the model provider and the server, which belong to the machine.

## Lending the web interface: kiosk mode

```bash
cv serve --user invitado1
```

The server is **pinned** to that user: the web interface loses the selector and there is no way to reach the
others. That is what you want when you hand someone your laptop for a while.

## Removing a user

```bash
cv users remove invitado1
```

It **does not delete**. It renames their whole space to `usuarios/invitado1.<stamp>.bak`, just like `cv import
--replace` does. To undo it, rename it back.

## Seeing who is there

```bash
cv users            # id, compiled name, whether it has sources, and its path
cv users path lucas
```

## The `.gitignore`

`cv init` already excludes `usuarios/*/data/dist/` and `usuarios/*/output/`: generated CVs and the artifact
contain personal data in the clear and are never versioned. If your workspace predates this, add them by hand.
