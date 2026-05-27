# Kiwi-Vibe

A vibed-up AI coding assistant that lives in your terminal — built from Kiwi and inspired by Milo.

Kiwi-Vibe brings Milo-style commands, pet XP, memory, and provider switching to the lightweight Kiwi core.

## Install

```bash
npm install
```

Or install globally:

```bash
npm install -g .
```

## Setup

Create a `.env` file (see `.env.example`) and add your API keys:

```env
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=optional_key_here
```

## Run

```bash
npm start
```

Or if installed globally:

```bash
kiwi-vibe
# or
kiwi
```

## Modes

- **agent** — full access: reads files, writes files, runs commands.
- **chat** — read-only: answers questions and reads files.
- **plan** — planning only: returns step-by-step plans without tool calls.

Switch with:

```
/mode agent|chat|plan
```

## Commands

```
/help          list all commands
/mode          switch between agent, chat, plan
/init          generate a KIWI.md in this project
/provider      manage ai providers (add/use/remove/list)
/pet           check kiwi's stats (alias: /stats)
/feed          feed kiwi to reset hunger
/vibe          vibe check your project (lvl 5)
/roast         roast your project (lvl 3)
/crimes        file a rap sheet on your project (lvl 10)
/achievements  show achievements (alias: /ach)
/login         sign in locally to track streaks
/logout        sign out
/whoami        check login status
/leaderboard   see your local leaderboard
/clear         clear the conversation
/genz          translate last reply into gen-z
```

## Memory

- **Global memory** lives at `~/.kiwi-vibe/memory/MEMORY.md`.
- **Project memory** lives in `KIWI.md` at your repo root (generated via `/init`).

## Providers

Kiwi-Vibe supports lightweight provider switching:

- **gemini** (default) — uses `GEMINI_API_KEY`
- **openai** — uses `OPENAI_API_KEY`

Manage them via:

```
/provider add
/provider list
/provider use <name>
/provider remove <name>
```

## Pet System

Every message earns XP and seeds 🌻. Kiwi gets hungry as you work — feed it with `/feed` to reset hunger and unlock achievements.

---

Made with 🥝 vibes.
