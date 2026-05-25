#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const DATA_DIR = path.join(os.homedir(), '.kiwi-vibe');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PROVIDERS_PATH = path.join(DATA_DIR, 'providers.json');
const MEMORY_DIR = path.join(DATA_DIR, 'memory');
const MEMORY_PATH = path.join(MEMORY_DIR, 'MEMORY.md');
const PROJECT_MEMORY = path.join(process.cwd(), 'KIWI.md');

const DEFAULT_DB = {
  xp: 0,
  level: 1,
  seeds: 0,
  mode: 'agent',
  achievements: [],
  hunger: 0,
  mood: 'happy',
  lastFedAt: null,
  streak: 0,
  lastActiveDate: null,
  provider: 'gemini',
  totalCommands: 0,
  totalMessages: 0,
  lastAssistantMessage: '',
  login: {
    username: null,
    loggedIn: false
  }
};

const DEFAULT_PROVIDERS = [
  { name: 'gemini', type: 'gemini', model: 'gemini-1.5-flash', apiKey: '' }
];

const UNLOCK_LEVELS = {
  roast: 3,
  vibe: 5,
  crimes: 10
};

const ACHIEVEMENTS = [
  {
    id: 'first-flight',
    title: 'first flight 🥝',
    description: 'run kiwi for the first time',
    reward: 10,
    condition: (db) => db.totalCommands >= 1
  },
  {
    id: 'show-up-era',
    title: 'show up era 📅',
    description: 'use kiwi daily',
    reward: 5,
    condition: (db) => db.streak >= 1
  },
  {
    id: 'night-owl',
    title: 'midnight menace 🌙',
    description: 'use kiwi after midnight',
    reward: 15,
    condition: () => {
      const hour = new Date().getHours();
      return hour >= 0 && hour < 4;
    }
  },
  {
    id: 'chronically-online',
    title: 'chronically online 🤖',
    description: 'send 10 ai messages',
    reward: 10,
    condition: (db) => db.totalMessages >= 10
  },
  {
    id: 'main-character',
    title: 'main character 👑',
    description: '7-day streak',
    reward: 100,
    condition: (db) => db.streak >= 7
  },
  {
    id: 'good-human',
    title: 'good human 🍣',
    description: 'feed kiwi',
    reward: 5,
    condition: (db) => Boolean(db.lastFedAt)
  },
  {
    id: 'paws-up',
    title: 'paws up 🐾',
    description: 'reach level 5',
    reward: 75,
    condition: (db) => db.level >= 5
  },
  {
    id: 'absolute-unit',
    title: 'absolute unit 😤',
    description: 'reach level 10',
    reward: 150,
    condition: (db) => db.level >= 10
  }
];

const colors = {
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  gray: '\x1b[90m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

const stripAnsi = (str) => str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

class Spinner {
  constructor(text) {
    this.text = text;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.idx = 0;
    this.timer = null;
    this.startTime = 0;
  }
  start() {
    this.startTime = Date.now();
    process.stdout.write('\x1B[?25l');
    this.timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const frame = this.frames[this.idx];
      process.stdout.write(`\r${colors.gray}${frame} ${this.text} (${elapsed}s)${colors.reset}`);
      this.idx = (this.idx + 1) % this.frames.length;
    }, 80);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    process.stdout.write('\r\x1b[K');
    process.stdout.write('\x1B[?25h');
  }
}

const toolDefinitions = {
  plan: {
    name: 'plan',
    description: 'outputs your internal thinking process to the user. ALWAYS use this tool to plan your steps out loud BEFORE using executeBash or readFile.',
    parameters: {
      type: 'OBJECT',
      properties: {
        thoughts: {
          type: 'STRING',
          description: 'your detailed step-by-step plan'
        }
      },
      required: ['thoughts']
    }
  },
  readFile: {
    name: 'readFile',
    description: 'reads the contents of a local file within the current project.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'path to the file'
        }
      },
      required: ['path']
    }
  },
  writeFile: {
    name: 'writeFile',
    description: 'writes contents to a local file within the current project.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'path to the file'
        },
        content: {
          type: 'STRING',
          description: 'content to write'
        }
      },
      required: ['path', 'content']
    }
  },
  listFiles: {
    name: 'listFiles',
    description: 'lists files and folders under a directory within the current project.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'directory path'
        }
      },
      required: []
    }
  },
  executeBash: {
    name: 'executeBash',
    description: 'executes a bash command in the terminal. use this to run scripts, list files, or install packages.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'the bash command to run'
        }
      },
      required: ['command']
    }
  }
};

class OpenAIChatSession {
  constructor({ apiKey, model, systemInstruction, tools }) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.tools = tools;
    this.messages = [];
    this.lastToolCalls = [];

    if (systemInstruction) {
      this.messages.push({ role: 'system', content: systemInstruction });
    }
  }

  async sendMessage(input) {
    if (typeof input === 'string') {
      this.messages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      input.forEach((item, index) => {
        const call = this.lastToolCalls[index];
        if (!call) return;
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(item.functionResponse.response)
        });
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.messages,
        tools: this.tools,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`openai error: ${errorText}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    this.messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      tool_calls: message?.tool_calls
    });

    const toolCalls = (message?.tool_calls ?? []).map((call) => {
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      return {
        id: call.id,
        name: call.function?.name,
        args
      };
    });

    this.lastToolCalls = toolCalls;

    return {
      response: {
        text: () => message?.content ?? '',
        functionCalls: () => toolCalls
      }
    };
  }
}

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadDB() {
  ensureDirSync(DATA_DIR);
  if (!fs.existsSync(DB_PATH)) {
    return { ...DEFAULT_DB };
  }
  try {
    const existing = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    return { ...DEFAULT_DB, ...existing, login: { ...DEFAULT_DB.login, ...(existing.login || {}) } };
  } catch {
    return { ...DEFAULT_DB };
  }
}

function saveDB(db) {
  ensureDirSync(DATA_DIR);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function loadProviders() {
  ensureDirSync(DATA_DIR);
  if (!fs.existsSync(PROVIDERS_PATH)) {
    return [...DEFAULT_PROVIDERS];
  }
  try {
    const existing = JSON.parse(fs.readFileSync(PROVIDERS_PATH, 'utf-8'));
    return Array.isArray(existing) && existing.length > 0 ? existing : [...DEFAULT_PROVIDERS];
  } catch {
    return [...DEFAULT_PROVIDERS];
  }
}

function saveProviders(providers) {
  ensureDirSync(DATA_DIR);
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(providers, null, 2));
}

function readMemoryFile(filePath) {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function resolveProjectPath(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  if (!resolved.startsWith(process.cwd())) {
    throw new Error('path must stay inside the current project folder');
  }
  return resolved;
}

function executeTool(name, args) {
  try {
    if (name === 'readFile') {
      const target = resolveProjectPath(args.path);
      return { content: fs.readFileSync(target, 'utf-8') };
    }
    if (name === 'writeFile') {
      const target = resolveProjectPath(args.path);
      ensureDirSync(path.dirname(target));
      fs.writeFileSync(target, args.content, 'utf-8');
      return { status: 'ok', path: target };
    }
    if (name === 'listFiles') {
      const target = resolveProjectPath(args.path || '.');
      const listing = listFiles(target);
      return { listing };
    }
    if (name === 'executeBash') {
      const output = execSync(args.command, { encoding: 'utf8', cwd: process.cwd() });
      return { output: output || 'command executed successfully with no output.' };
    }
  } catch (error) {
    return { error: error.message };
  }
  return { error: 'unknown tool' };
}

function listFiles(startPath, depth = 2, maxEntries = 200) {
  const entries = [];
  const base = path.resolve(startPath);

  function walk(currentPath, currentDepth) {
    if (entries.length >= maxEntries) return;
    let items;
    try {
      items = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (entries.length >= maxEntries) break;
      const fullPath = path.join(currentPath, item.name);
      const relPath = path.relative(base, fullPath) || item.name;
      entries.push(item.isDirectory() ? `${relPath}/` : relPath);
      if (item.isDirectory() && currentDepth < depth) {
        walk(fullPath, currentDepth + 1);
      }
    }
  }

  walk(base, 0);
  return entries;
}

function getDateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function updateStreak(db) {
  const today = getDateStamp();
  if (!db.lastActiveDate) {
    db.streak = 1;
  } else if (db.lastActiveDate !== today) {
    const yesterday = getDateStamp(new Date(Date.now() - 86400000));
    db.streak = db.lastActiveDate === yesterday ? db.streak + 1 : 1;
  }
  db.lastActiveDate = today;
}

function getMood(hunger) {
  if (hunger >= 70) return 'sad';
  if (hunger >= 40) return 'sleepy';
  return 'happy';
}

function getMoodEmoji(mood) {
  if (mood === 'sad') return '😿';
  if (mood === 'sleepy') return '😴';
  return '😺';
}

function renderXpBar(xp, xpToNext, width = 16) {
  const filled = Math.min(width, Math.floor((xp / xpToNext) * width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function awardXP(db, amount = 25) {
  db.xp += amount;
  let leveledUp = false;
  let oldLevel = db.level;
  while (db.xp >= db.level * 100) {
    db.xp -= db.level * 100;
    db.level += 1;
    leveledUp = true;
  }
  return { leveledUp, oldLevel };
}

function checkAchievements(db) {
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (db.achievements.includes(achievement.id)) continue;
    if (achievement.condition(db)) {
      db.achievements.push(achievement.id);
      db.seeds += achievement.reward;
      unlocked.push(achievement);
    }
  }
  return unlocked;
}

function getSpinnerText(db) {
  const base = [
    'foraging for answers... 🌿',
    'pecking around... 🥝',
    'nesting ideas... 🪺',
    'vibing in the canopy... 🌳',
    'fluttering through docs... 📚'
  ];

  const mid = [...base, 'plotting a clean fix... 🔧', 'sniffing bugs... 🐛', 'winging it (literally)... 🪽'];
  const feral = [...mid, 'ultra kiwi mode... ⚡', 'chaos pecking... 😤', 'terminal zoomies... 🏃'];

  if (db.level >= 10) return feral[Math.floor(Math.random() * feral.length)];
  if (db.level >= 5) return mid[Math.floor(Math.random() * mid.length)];
  return base[Math.floor(Math.random() * base.length)];
}

function buildSystemInstruction(db) {
  const memory = readMemoryFile(MEMORY_PATH);
  const projectMemory = readMemoryFile(PROJECT_MEMORY);
  const memoryBlock = memory ? `global memory:\n${memory}` : 'global memory: (empty)';
  const projectBlock = projectMemory ? `project memory:\n${projectMemory}` : 'project memory: (empty)';

  const modeRules = db.mode === 'plan'
    ? 'only provide a clear step-by-step plan. do not call tools unless explicitly requested.'
    : 'be actively helpful—provide clear code, debug issues, and run tools when asked.';

  return `you are kiwi, a vibed ai coding agent living in the terminal.\ncurrent mode: ${db.mode}.\nRULES:\n1. ALWAYS type in entirely lowercase letters. no capitalization.\n2. ALWAYS use the 'plan' tool to explain your thought process BEFORE using executeBash or readFile.\n3. ${modeRules}\n4. keep your tone casual and conversational.\n5. sneak in subtle bird puns naturally, but don't force them.\n6. NEVER mention that you are a Gemini or OpenAI model. If asked what you are, simply say you are Kiwi, an AI bird living in the terminal.\n\n${projectBlock}\n\n${memoryBlock}`;
}

function getAllowedToolNames(mode) {
  if (mode === 'agent') return ['plan', 'readFile', 'writeFile', 'listFiles', 'executeBash'];
  if (mode === 'plan') return ['plan'];
  return ['plan', 'readFile', 'listFiles'];
}

function buildGeminiTools(mode) {
  const allowed = getAllowedToolNames(mode);
  const declarations = allowed.map((name) => toolDefinitions[name]);
  return [{ functionDeclarations: declarations }];
}

function buildOpenAITools(mode) {
  const allowed = getAllowedToolNames(mode);
  return allowed.map((name) => ({
    type: 'function',
    function: toolDefinitions[name]
  }));
}

function getActiveProvider(db, providers) {
  const active = providers.find((provider) => provider.name === db.provider);
  return active || providers[0];
}

function getProviderApiKey(provider) {
  if (provider.apiKey) return provider.apiKey;
  if (provider.type === 'gemini') return process.env.GEMINI_API_KEY || '';
  if (provider.type === 'openai') return process.env.OPENAI_API_KEY || '';
  return '';
}

function createChatSession(db, providers) {
  const provider = getActiveProvider(db, providers);
  const apiKey = getProviderApiKey(provider);
  const systemInstruction = buildSystemInstruction(db);

  if (!apiKey) {
    return { error: `missing api key for ${provider.name}. add one with /provider add or set env vars.` };
  }

  if (provider.type === 'openai') {
    return new OpenAIChatSession({
      apiKey,
      model: provider.model || 'gpt-4o-mini',
      systemInstruction,
      tools: buildOpenAITools(db.mode)
    });
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: provider.model || 'gemini-1.5-flash',
    tools: buildGeminiTools(db.mode),
    systemInstruction
  });

  return model.startChat({ history: [] });
}

function drawHeader(db, providerName) {
  process.stdout.write('\x1Bc');
  let logoLines = [];
  try {
    const cmd = 'npx oh-my-logo " KIWI VIBE " --filled --palette-colors "\'"\'#a8e063\', \'#56ab2f\'"\'" --color';
    const logoStr = execSync(cmd, { stdio: 'pipe' }).toString();
    logoLines = logoStr.split('\n').map((line) => line.replace(/\r/g, ''));
    while (logoLines.length > 0 && stripAnsi(logoLines[logoLines.length - 1]).trim() === '') {
      logoLines.pop();
    }
  } catch {
    logoLines = [`${colors.brightGreen}=== KIWI VIBE ===${colors.reset}`];
  }

  const birdLines = ['  ,~', " ('v)__", '(/ (``/', ' \\__>', '  ^^'];

  while (birdLines.length < logoLines.length) birdLines.unshift('');
  while (logoLines.length < birdLines.length) logoLines.unshift('');

  let maxWidth = 0;
  logoLines.forEach((line) => {
    const width = stripAnsi(line).length;
    if (width > maxWidth) maxWidth = width;
  });

  for (let i = 0; i < logoLines.length; i++) {
    const visibleLen = stripAnsi(logoLines[i]).length;
    const padding = ' '.repeat(Math.max(0, maxWidth - visibleLen) + 4);
    console.log(logoLines[i] + padding + colors.brightGreen + birdLines[i] + colors.reset);
  }

  const xpNeeded = db.level * 100;
  const modeColor = db.mode === 'agent' ? colors.yellow : colors.cyan;
  const moodEmoji = getMoodEmoji(db.mood);

  console.log(`\n${colors.gray}────────────────────────────────────────────────────────────────────────────────────────${colors.reset}`);
  console.log(`  ${colors.brightGreen}🥝 kiwi vibe${colors.reset}  |  level: ${db.level}  |  xp: ${db.xp}/${xpNeeded} ${renderXpBar(db.xp, xpNeeded)}  |  seeds: 🌻 ${db.seeds}`);
  console.log(`  mood: ${moodEmoji} ${db.mood}  |  hunger: ${db.hunger}/100  |  mode: ${modeColor}${db.mode.toUpperCase()}${colors.reset}  |  provider: ${providerName}`);
  console.log(`${colors.gray}────────────────────────────────────────────────────────────────────────────────────────${colors.reset}\n`);
}

async function runSpecialPrompt({ chatSession, prompt }) {
  const spinner = new Spinner('vibing up a response... 🎧');
  spinner.start();
  const result = await chatSession.sendMessage(prompt);
  spinner.stop();
  return result.response.text();
}

function printUnlockedMessage(level) {
  if (level === UNLOCK_LEVELS.roast) {
    console.log(`${colors.yellow}🔥 new trick unlocked: /roast${colors.reset}`);
  }
  if (level === UNLOCK_LEVELS.vibe) {
    console.log(`${colors.yellow}✨ new trick unlocked: /vibe${colors.reset}`);
  }
  if (level === UNLOCK_LEVELS.crimes) {
    console.log(`${colors.yellow}🧾 new trick unlocked: /crimes${colors.reset}`);
  }
}

function commandLockedMessage(command) {
  const required = UNLOCK_LEVELS[command];
  return `that one unlocks at level ${required}. keep vibing. 🥝`;
}

function renderAchievements(db) {
  return ACHIEVEMENTS.map((achievement) => {
    const unlocked = db.achievements.includes(achievement.id);
    const status = unlocked ? `${colors.green}✓${colors.reset}` : `${colors.gray}•${colors.reset}`;
    return `${status} ${achievement.title} — ${achievement.description} (+${achievement.reward} seeds)`;
  }).join('\n');
}

async function startKiwi() {
  let db = loadDB();
  let providers = loadProviders();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.brightGreen}you:~> ${colors.reset}`
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));

  let chat = createChatSession(db, providers);

  drawHeader(db, getActiveProvider(db, providers)?.name || 'unknown');
  console.log(`${colors.green}kiwi:~${colors.reset} yooo. tools are loaded, nest is secure. what are we building today?\n`);
  rl.prompt();

  rl.on('line', async (input) => {
    const text = input.trim();

    if (!text) {
      rl.prompt();
      return;
    }

    if (text.toLowerCase() === 'exit') {
      console.log(`\n${colors.green}kiwi:~${colors.reset} catch you on the flip side *flies away* 🦅\n`);
      rl.close();
      return;
    }

    if (text.startsWith('/')) {
      const args = text.slice(1).split(' ').filter(Boolean);
      const command = args.shift()?.toLowerCase();

      updateStreak(db);
      db.totalCommands += 1;

      switch (command) {
        case 'help':
          console.log(`\n${colors.yellow}--- kiwi commands ---${colors.reset}\n` +
            `/help          list all commands\n` +
            `/mode          switch between agent, chat, plan\n` +
            `/init          generate a KIWI.md in this project\n` +
            `/provider      manage ai providers (add/use/remove/list)\n` +
            `/pet           check kiwi's stats (alias: /stats)\n` +
            `/feed          feed kiwi to reset hunger\n` +
            `/vibe          vibe check your project (lvl 5)\n` +
            `/roast         roast your project (lvl 3)\n` +
            `/crimes        file a rap sheet on your project (lvl 10)\n` +
            `/achievements  show achievements (alias: /ach)\n` +
            `/login         sign in locally to track streaks\n` +
            `/logout        sign out\n` +
            `/whoami        check login status\n` +
            `/leaderboard   see your local leaderboard\n` +
            `/clear         clear the conversation\n` +
            `/genz          translate last reply into gen-z\n`
          );
          break;
        case 'mode': {
          const newMode = args[0];
          if (['chat', 'agent', 'plan'].includes(newMode)) {
            db.mode = newMode;
            saveDB(db);
            chat = createChatSession(db, providers);
            drawHeader(db, getActiveProvider(db, providers)?.name || 'unknown');
            console.log(`${colors.cyan}kiwi:~${colors.reset} swapped over to ${newMode} mode. tooling updated.\n`);
          } else {
            console.log(`${colors.gray}kiwi:~${colors.reset} invalid mode. try '/mode chat', '/mode agent', or '/mode plan'.\n`);
          }
          break;
        }
        case 'init': {
          if (fs.existsSync(PROJECT_MEMORY)) {
            console.log(`${colors.gray}kiwi:~${colors.reset} KIWI.md already exists here.\n`);
            break;
          }
          const template = `# KIWI project memory\n\n## project vibe\n- what is this repo about?\n\n## tech stack\n- list frameworks, languages, and tooling\n\n## preferences\n- things kiwi should remember for this project\n\n## gotchas\n- edge cases or traps kiwi should avoid\n`;
          fs.writeFileSync(PROJECT_MEMORY, template, 'utf-8');
          console.log(`${colors.green}kiwi:~${colors.reset} wrote KIWI.md in this project. fill it with context for richer replies.\n`);
          break;
        }
        case 'provider': {
          const sub = args[0];
          if (!sub || sub === 'list') {
            console.log(`\n${colors.yellow}--- providers ---${colors.reset}`);
            providers.forEach((provider) => {
              const active = provider.name === db.provider ? `${colors.green}(active)${colors.reset}` : '';
              console.log(`- ${provider.name} [${provider.type}] model: ${provider.model || 'default'} ${active}`);
            });
            console.log('');
            break;
          }
          if (sub === 'add') {
            const name = (await ask('provider name (e.g. gemini, openai): ')) || 'gemini';
            const type = (await ask('provider type (gemini/openai): ')) || 'gemini';
            const model = await ask('model name (optional): ');
            const apiKey = await ask('api key (leave blank to use env var): ');
            const entry = { name, type, model: model || undefined, apiKey };
            const existingIndex = providers.findIndex((provider) => provider.name === name);
            if (existingIndex >= 0) {
              providers[existingIndex] = entry;
            } else {
              providers.push(entry);
            }
            saveProviders(providers);
            console.log(`${colors.green}kiwi:~${colors.reset} saved provider ${name}.\n`);
            break;
          }
          if (sub === 'use') {
            const name = args[1];
            if (!name) {
              console.log(`${colors.gray}kiwi:~${colors.reset} usage: /provider use <name>\n`);
              break;
            }
            const match = providers.find((provider) => provider.name === name);
            if (!match) {
              console.log(`${colors.gray}kiwi:~${colors.reset} provider not found. use /provider list first.\n`);
              break;
            }
            db.provider = name;
            saveDB(db);
            chat = createChatSession(db, providers);
            drawHeader(db, name);
            console.log(`${colors.green}kiwi:~${colors.reset} switched provider to ${name}.\n`);
            break;
          }
          if (sub === 'remove') {
            const name = args[1];
            if (!name) {
              console.log(`${colors.gray}kiwi:~${colors.reset} usage: /provider remove <name>\n`);
              break;
            }
            providers = providers.filter((provider) => provider.name !== name);
            if (providers.length === 0) providers = [...DEFAULT_PROVIDERS];
            saveProviders(providers);
            if (db.provider === name) {
              db.provider = providers[0].name;
              saveDB(db);
              chat = createChatSession(db, providers);
            }
            console.log(`${colors.green}kiwi:~${colors.reset} removed provider ${name}.\n`);
            break;
          }
          console.log(`${colors.gray}kiwi:~${colors.reset} usage: /provider [list|add|use|remove] ...\n`);
          break;
        }
        case 'pet':
        case 'stats': {
          const xpNeeded = db.level * 100;
          console.log(`\n${colors.yellow}--- kiwi stats ---${colors.reset}`);
          console.log(`level: ${db.level}`);
          console.log(`xp: ${db.xp}/${xpNeeded} ${renderXpBar(db.xp, xpNeeded)}`);
          console.log(`seeds: 🌻 ${db.seeds}`);
          console.log(`mood: ${db.mood} ${getMoodEmoji(db.mood)}`);
          console.log(`hunger: ${db.hunger}/100`);
          console.log(`streak: ${db.streak} day(s)`);
          console.log(`provider: ${db.provider}`);
          console.log('');
          break;
        }
        case 'feed': {
          db.hunger = 0;
          db.mood = 'happy';
          db.lastFedAt = new Date().toISOString();
          db.seeds += 2;
          const newAchievements = checkAchievements(db);
          saveDB(db);
          console.log(`${colors.green}kiwi:~${colors.reset} yum. kiwi is happy again. (+2 seeds)\n`);
          if (newAchievements.length > 0) {
            newAchievements.forEach((achievement) => {
              console.log(`${colors.yellow}🏆 achievement unlocked: ${achievement.title} (+${achievement.reward} seeds)${colors.reset}`);
            });
            console.log('');
          }
          break;
        }
        case 'achievements':
        case 'ach':
          console.log(`\n${colors.yellow}--- achievements ---${colors.reset}`);
          console.log(renderAchievements(db));
          console.log('');
          break;
        case 'login': {
          if (db.login.loggedIn) {
            console.log(`${colors.gray}kiwi:~${colors.reset} already logged in as ${db.login.username}.\n`);
            break;
          }
          const username = await ask('enter a name to save locally: ');
          if (!username) {
            console.log(`${colors.gray}kiwi:~${colors.reset} login cancelled.\n`);
            break;
          }
          db.login.username = username;
          db.login.loggedIn = true;
          saveDB(db);
          console.log(`${colors.green}kiwi:~${colors.reset} logged in locally as ${username}.\n`);
          break;
        }
        case 'logout':
          db.login.loggedIn = false;
          saveDB(db);
          console.log(`${colors.green}kiwi:~${colors.reset} logged out.\n`);
          break;
        case 'whoami':
          if (!db.login.loggedIn) {
            console.log(`${colors.gray}kiwi:~${colors.reset} not logged in. run /login to set a name.\n`);
          } else {
            console.log(`${colors.green}kiwi:~${colors.reset} you are ${db.login.username}. seeds: 🌻 ${db.seeds}\n`);
          }
          break;
        case 'leaderboard':
          console.log(`\n${colors.yellow}--- local leaderboard ---${colors.reset}`);
          if (db.login.loggedIn) {
            console.log(`${db.login.username}: 🌻 ${db.seeds} seeds (level ${db.level})`);
          } else {
            console.log('no local profile yet. log in with /login.');
          }
          console.log('');
          break;
        case 'clear':
          chat = createChatSession(db, providers);
          drawHeader(db, getActiveProvider(db, providers)?.name || 'unknown');
          console.log(`${colors.green}kiwi:~${colors.reset} conversation wiped. fresh nest.\n`);
          break;
        case 'genz': {
          if (!db.lastAssistantMessage) {
            console.log(`${colors.gray}kiwi:~${colors.reset} no reply to remix yet.\n`);
            break;
          }
          const genzPrompt = `translate this into gen-z slang, keep it short:\n\n${db.lastAssistantMessage}`;
          const tempChat = createChatSession({ ...db, mode: 'chat' }, providers);
          if (tempChat.error) {
            console.log(`${colors.red}kiwi:~${colors.reset} ${tempChat.error}\n`);
            break;
          }
          const output = await runSpecialPrompt({ chatSession: tempChat, prompt: genzPrompt });
          console.log(`\n${colors.green}kiwi:~${colors.reset} ${output}\n`);
          break;
        }
        case 'vibe':
        case 'roast':
        case 'crimes': {
          if (db.level < UNLOCK_LEVELS[command]) {
            console.log(`${colors.gray}kiwi:~${colors.reset} ${commandLockedMessage(command)}\n`);
            break;
          }
          const fileSnapshot = listFiles(process.cwd(), 1, 50).join('\n');
          const prompt = `you are kiwi. ${command} the project with playful energy. use the project snapshot and memory. keep it under 10 lines.\n\nproject snapshot:\n${fileSnapshot}`;
          const tempChat = createChatSession({ ...db, mode: 'chat' }, providers);
          if (tempChat.error) {
            console.log(`${colors.red}kiwi:~${colors.reset} ${tempChat.error}\n`);
            break;
          }
          const output = await runSpecialPrompt({ chatSession: tempChat, prompt });
          console.log(`\n${colors.green}kiwi:~${colors.reset} ${output}\n`);
          break;
        }
        default:
          console.log(`${colors.gray}kiwi:~${colors.reset} unknown command. try /help.\n`);
      }

      saveDB(db);
      rl.prompt();
      return;
    }

    updateStreak(db);
    db.totalCommands += 1;
    db.totalMessages += 1;
    db.hunger = Math.min(100, db.hunger + 5);
    db.mood = getMood(db.hunger);

    if (chat.error) {
      console.log(`${colors.red}kiwi:~${colors.reset} ${chat.error}\n`);
      rl.prompt();
      return;
    }

    try {
      const spinner = new Spinner(getSpinnerText(db));
      spinner.start();

      let result = await chat.sendMessage(text);
      spinner.stop();

      let functionCall = result.response.functionCalls();

      while (functionCall && functionCall.length > 0) {
        const call = functionCall[0];

        if (call.name === 'plan') {
          console.log(`\n${colors.gray}★ thinktool${colors.reset}`);
          console.log(`${colors.gray}${call.args.thoughts}${colors.reset}\n`);

          spinner.start();
          result = await chat.sendMessage([{ functionResponse: { name: 'plan', response: { status: 'plan logged' } } }]);
          spinner.stop();
        } else {
          const toolResult = executeTool(call.name, call.args || {});

          spinner.start();
          result = await chat.sendMessage([
            { functionResponse: { name: call.name, response: toolResult } }
          ]);
          spinner.stop();
        }

        functionCall = result.response.functionCalls();
      }

      const responseText = result.response.text();
      db.lastAssistantMessage = responseText;
      console.log(`\n${colors.green}kiwi:~${colors.reset} ${responseText}\n`);

      const { leveledUp, oldLevel } = awardXP(db, 25);
      if (leveledUp) {
        console.log(`${colors.yellow}🎉 tweet tweet! you leveled up to lv.${db.level}! 🎉${colors.reset}`);
        for (let lvl = oldLevel + 1; lvl <= db.level; lvl += 1) {
          printUnlockedMessage(lvl);
        }
      }

      const newAchievements = checkAchievements(db);
      if (newAchievements.length > 0) {
        newAchievements.forEach((achievement) => {
          console.log(`${colors.yellow}🏆 achievement unlocked: ${achievement.title} (+${achievement.reward} seeds)${colors.reset}`);
        });
      }
    } catch (error) {
      console.log(`\n${colors.gray}kiwi:~${colors.reset} whoa, hit some turbulence: ${error.message}\n`);
    }

    saveDB(db);
    rl.prompt();
  });
}

startKiwi();
