#!/usr/bin/env node
/**
 * Auto-updates the "What I'm Working On" section of README.md.
 *
 * Runs inside GitHub Actions. When ACTIVITY_TOKEN (a Personal Access Token with
 * read access to your repos) is present, private repos are included but shown
 * REDACTED — name and commit message are never written to the public README,
 * only "Private project", the language, and how long ago it was pushed.
 *
 * Without a PAT it falls back to public repos only.
 */

import { readFile, writeFile } from 'node:fs/promises';

const TOKEN = process.env.ACTIVITY_TOKEN || process.env.GITHUB_TOKEN;
const USERNAME = process.env.GH_USERNAME || 'KR-16';
const HAS_PAT = Boolean(process.env.ACTIVITY_TOKEN);
const README = 'README.md';
const MAX_ITEMS = 5;
const START = '<!--START_SECTION:activity-->';
const END = '<!--END_SECTION:activity-->';

if (!TOKEN) {
  console.error('No token available (ACTIVITY_TOKEN / GITHUB_TOKEN).');
  process.exit(1);
}

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USERNAME,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
};

const relTime = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
};

const langEmoji = (lang) =>
  ({
    Python: '🐍', JavaScript: '📜', TypeScript: '📘', 'Jupyter Notebook': '📓',
    C: '💠', 'C++': '💠', Java: '☕', Go: '🐹', Rust: '🦀', HTML: '🌐',
    Shell: '🐚', Dockerfile: '🐳',
  }[lang] || '🛠️');

const firstLine = (s, n = 72) => {
  const line = (s || '').split('\n')[0].trim();
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

const main = async () => {
  const reposPath = HAS_PAT
    ? '/user/repos?sort=pushed&direction=desc&per_page=30&visibility=all&affiliation=owner'
    : `/users/${USERNAME}/repos?sort=pushed&direction=desc&per_page=30&type=owner`;

  const repos = (await api(reposPath))
    .filter((r) => !r.archived && r.name !== USERNAME) // skip archived + the profile repo itself
    .slice(0, MAX_ITEMS);

  const lines = [];
  for (const repo of repos) {
    const when = relTime(repo.pushed_at);
    if (repo.private) {
      // Redacted: never leak the private repo's name or commit message.
      const langPart = repo.language ? ` (${repo.language})` : '';
      lines.push(`- 🔒 **Private project** — updated ${when}${langPart}`);
    } else {
      let msg = '';
      try {
        const commits = await api(`/repos/${repo.full_name}/commits?per_page=1`);
        const message = commits?.[0]?.commit?.message;
        if (message) msg = ` — _"${firstLine(message)}"_`;
      } catch {
        /* empty repo or no access — just omit the message */
      }
      lines.push(
        `- ${langEmoji(repo.language)} [**${repo.name}**](${repo.html_url})${msg} · ${when}`,
      );
    }
  }

  const top = repos[0];
  let headline = '';
  if (top) {
    headline = top.private
      ? `🔨 Currently working on a **private project** · updated ${relTime(top.pushed_at)}`
      : `🔨 Currently working on [**${top.name}**](${top.html_url}) · updated ${relTime(top.pushed_at)}`;
  }

  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const body = [
    headline ? `> ${headline}` : '_No recent activity found._',
    '',
    ...lines,
    '',
    `<sub>🔄 Auto-updated ${stamp} UTC</sub>`,
  ].join('\n');

  const readme = await readFile(README, 'utf8');
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s === -1 || e === -1) {
    console.error('Activity markers not found in README.md.');
    process.exit(1);
  }
  const updated = readme.slice(0, s + START.length) + `\n${body}\n` + readme.slice(e);

  if (updated === readme) {
    console.log('Activity section already up to date.');
    return;
  }
  await writeFile(README, updated);
  console.log('README activity section updated.');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
