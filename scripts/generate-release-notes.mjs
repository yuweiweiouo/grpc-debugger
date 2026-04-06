import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function runGitLog(range) {
  const output = execFileSync(
    'git',
    ['log', '--pretty=format:%s%x09%h', range],
    { encoding: 'utf8' }
  ).trim();

  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => {
      const [subject, hash] = line.split('\t');
      return { subject: subject?.trim() ?? '', hash: hash?.trim() ?? '' };
    })
    .filter(({ subject }) => subject)
    .filter(({ subject }) => !/^chore:\s*release\s+v?\d+\.\d+\.\d+/i.test(subject));
}

const version = readArg('--version');
const from = readArg('--from');
const to = readArg('--to', 'HEAD');
const outputPath = readArg('--output');
const range = from ? `${from}..${to}` : to;
const commits = runGitLog(range);

const lines = [
  '## 這次更新',
  commits.length
    ? commits.map(({ subject, hash }) => `- ${subject} (${hash})`).join('\n')
    : '- 例行維護、版本同步與發版整理',
  '',
];

if (version) {
  lines.unshift(`版本：v${version}`, '');
}

const content = `${lines.join('\n')}\n`;

if (outputPath) {
  fs.writeFileSync(path.resolve(outputPath), content, 'utf8');
} else {
  process.stdout.write(content);
}
