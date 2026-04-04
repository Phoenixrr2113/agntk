/**
 * @file Auto-install shell completions.
 * Detects the user's shell, writes the completion script to ~/.agntk/completions/,
 * and patches the shell rc file once `agntk` is on $PATH.
 *
 * Two markers track state independently:
 *   .script-written — completion script file exists, no need to regenerate
 *   .rc-patched     — rc file has the source line, no need to re-append
 *
 * On every run: if the script isn't written, write it. If rc isn't patched
 * and agntk is on $PATH, patch it. Fully automatic, zero user action.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { generateCompletionScript, type Shell } from './completions';

const COMPLETIONS_DIR = join(homedir(), '.agntk', 'completions');
const SCRIPT_MARKER = join(COMPLETIONS_DIR, '.script-written');
const RC_MARKER = join(COMPLETIONS_DIR, '.rc-patched');

interface ShellConfig {
  shell: Shell;
  ext: string;
  rcFile: string;
  sourceLine: string;
}

/**
 *
 */
function detectShell(): ShellConfig | null {
  const shellEnv = process.env.SHELL ?? '';
  const shellName = shellEnv.split('/').pop() ?? '';

  const completionPath = (ext: string) => join(COMPLETIONS_DIR, `agntk.${ext}`);

  switch (shellName) {
    case 'zsh':
      return {
        shell: 'zsh',
        ext: 'zsh',
        rcFile: join(homedir(), '.zshrc'),
        sourceLine: `\n# agntk shell completions\nsource "${completionPath('zsh')}"\n`,
      };
    case 'bash': {
      const bashrc = join(homedir(), '.bashrc');
      const profile = join(homedir(), '.bash_profile');
      const rcFile = existsSync(bashrc) ? bashrc : profile;
      return {
        shell: 'bash',
        ext: 'bash',
        rcFile,
        sourceLine: `\n# agntk shell completions\nsource "${completionPath('bash')}"\n`,
      };
    }
    case 'fish':
      return {
        shell: 'fish',
        ext: 'fish',
        rcFile: join(homedir(), '.config', 'fish', 'completions', 'agntk.fish'),
        sourceLine: '',
      };
    default:
      return null;
  }
}

/**
 *
 * @param rcFile
 */
function rcAlreadyHasEntry(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;
  try {
    return readFileSync(rcFile, 'utf-8').includes('agntk shell completions');
  } catch {
    return false;
  }
}

/** Check if agntk is globally installed (not just available via npx/node_modules/.bin) */
function isGloballyInstalled(): boolean {
  try {
    const result = execSync('which agntk', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // npx/pnpm inject node_modules/.bin into PATH — that's not a real global install
    return result.length > 0 && !result.includes('node_modules');
  } catch {
    return false;
  }
}

/**
 * Ensure shell completions are installed. Called on every run.
 * Fast no-op when both markers exist. Never throws.
 */
export function ensureCompletions(): void {
  try {
    const scriptDone = existsSync(SCRIPT_MARKER);
    const rcDone = existsSync(RC_MARKER);

    // Both done — nothing to do
    if (scriptDone && rcDone) return;

    const config = detectShell();
    if (!config) return;

    mkdirSync(COMPLETIONS_DIR, { recursive: true });

    // Step 1: Write the completion script (once)
    if (!scriptDone) {
      const script = generateCompletionScript(config.shell);
      const completionFile = join(COMPLETIONS_DIR, `agntk.${config.ext}`);
      writeFileSync(completionFile, script, 'utf-8');
      writeFileSync(SCRIPT_MARKER, new Date().toISOString(), 'utf-8');
    }

    // Step 2: Patch the rc file (once agntk is globally available)
    if (!rcDone && isGloballyInstalled()) {
      if (config.shell === 'fish') {
        const fishDir = join(homedir(), '.config', 'fish', 'completions');
        mkdirSync(fishDir, { recursive: true });
        const script = generateCompletionScript(config.shell);
        writeFileSync(join(fishDir, 'agntk.fish'), script, 'utf-8');
      } else {
        if (!rcAlreadyHasEntry(config.rcFile)) {
          appendFileSync(config.rcFile, config.sourceLine, 'utf-8');
        }
      }
      writeFileSync(RC_MARKER, new Date().toISOString(), 'utf-8');
    }
  } catch {
    // Silent — completions are nice-to-have
  }
}
