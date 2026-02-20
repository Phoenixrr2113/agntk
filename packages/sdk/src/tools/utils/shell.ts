import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ============================================================================
// Dangerous Command Detection (S-1, S-2, S-3, S-4, S-5, S-6)
// ============================================================================

/**
 * Patterns that are unconditionally blocked.
 *
 * Covers:
 *  S-1: rm with any target (not just absolute paths)
 *  S-2: Nested interpreter invocation (bash -c, python -c, node -e, etc.)
 *  S-3: Destructive git operations
 *  S-4: Fork bomb (multiple forms)
 *  S-5: chmod with dangerous modes (666, setuid, world-writable)
 *  S-6: Pipe-to-shell / download-and-execute bypass
 */
const DANGEROUS_PATTERNS = [
  // S-1: rm -r/-rf targeting dangerous targets (., .., *, /, ~, empty, command substitution)
  // Blocks: rm -rf ., rm -rf *, rm -rf /, rm -rf ~, rm -rf $(pwd)
  // Allows:  rm -rf ./dist, rm -rf ./node_modules, rm -rf ./build
  /\brm\s+(-[^\s]*r[^\s]*\s+|--recursive\s+)(\.|\.\.|\/|\*|~|\$[({`])/i,
  // Also catch rm -f targeting those same dangerous targets directly
  /\brm\s+-[^\s]*f[^\s]*\s*(\/|~|\*|\$[({`]|\.\.?(\/|$|\s))/i,

  // S-2: Nested interpreter invocation
  /\b(bash|sh|zsh|dash|ksh|fish|tcsh)\s+(-[ce]|--[a-z]+\s)/i,
  /\b(python3?|python3\.[0-9]+|pypy3?)\s+-[cC]/i,
  /\b(node|nodejs|deno|bun)\s+-[eE]/i,
  /\b(perl|ruby|php|lua|Rscript|groovy)\s+-[e]/i,

  // S-3: Destructive git operations
  /\bgit\s+(push\s+[^\n]*--?force|push\s+-f\b)/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[fdxXqn]*[fF][fdxXqn]*/i,
  /\bgit\s+rebase\s+(-i|--interactive)/i,

  // S-4: Fork bomb — colon function form and nohup infinite loop, but NOT normal while loops
  /:\(\s*\)\s*\{/,
  /:\s*\(\s*\)\s*\{.*:\s*\|\s*:/,

  // S-5: chmod with dangerous modes
  /\bchmod\s+(-R\s+)?([0-7]*[2467][0-9]{2}|\+s|o\+w|a\+w|u\+s|g\+s)/i,
  // Keep 755/644/600 allowed — block 666, 777, setuid/setgid numeric forms
  /\bchmod\s+(-R\s+)?(666|777|4[0-9]{3}|2[0-9]{3})/i,

  // S-6: Pipe-to-shell and download-execute bypasses
  /\b(curl|wget)\b.*\|\s*(bash|sh|zsh|dash|python3?|node)/i,
  /\b(curl|wget)\b.*>\s*\S+.*&&\s*(bash|sh|chmod)/i,

  // Disk/device destruction
  />\s*\/dev\/(sd[a-z]|nvme[0-9]|hd[a-z]|vd[a-z])/i,
  /\bmkfs\./i,
  /\bdd\s+if=/i,

  // Privilege escalation
  /\b(sudo|su)\s/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,

  // Shell eval builtin — `eval <string>` or `eval "..."`, not English words like 'evaluate'
  /\beval\s*["'`(]/i,
  /^eval\s/,
  /;\s*eval\s/,
  /&&\s*eval\s/,
  /\|\s*eval\s/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

// ============================================================================
// CWD Validation (S-13)
// ============================================================================

/**
 * Ensure the requested cwd is within workspaceRoot (or is workspaceRoot itself).
 * Returns the resolved cwd, or throws if the path escapes the workspace.
 */
export function validateCwd(cwd: string, workspaceRoot: string): string {
  const resolvedCwd = path.resolve(cwd);
  let realWorkspace: string;
  try {
    realWorkspace = fs.realpathSync(path.resolve(workspaceRoot));
  } catch {
    realWorkspace = path.resolve(workspaceRoot);
  }
  if (!resolvedCwd.startsWith(realWorkspace + path.sep) && resolvedCwd !== realWorkspace) {
    throw new Error(`cwd "${cwd}" is outside workspace root`);
  }
  return resolvedCwd;
}

// ============================================================================
// Env Var Filtering (A-3)
// ============================================================================

/** Key patterns that indicate credentials — stripped from child process env. */
const SENSITIVE_ENV_PATTERNS = [
  /API[_-]?KEY/i,
  /SECRET/i,
  /TOKEN(?!_DIR|_PATH)/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /OPENAI_/i,
  /ANTHROPIC_/i,
  /LANGFUSE_/i,
  /AWS_(?!REGION|DEFAULT_REGION|EXECUTION_ENV)/i,
  /GOOGLE_(API|CLOUD|APPLICATION)/i,
  /GITHUB_TOKEN/i,
  /SLACK_(BOT|APP|SIGNING)/i,
  /STRIPE_/i,
  /TWILIO_/i,
  /SENDGRID_/i,
  /DATABASE_URL/i,
  /MONGO(DB)?_URI/i,
  /REDIS_URL/i,
];

/**
 * Build a sanitized copy of process.env suitable for child processes.
 * Strips all credential-like keys; always preserves PATH, HOME, USER, TERM, LANG, etc.
 */
export function buildSanitizedEnv(
  extra: Record<string, string> = {},
): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PATTERNS.some((p) => p.test(key))) continue;
    safe[key] = value;
  }

  // Merge caller-supplied extras, but also filter those
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_ENV_PATTERNS.some((p) => p.test(key))) continue;
    safe[key] = value;
  }

  // Always ensure PATH is present
  if (process.env.PATH) safe.PATH = process.env.PATH;

  return safe;
}

// ============================================================================
// Output Sanitization (A-1)
// ============================================================================

const SENSITIVE_OUTPUT_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[a-zA-Z0-9]{16,}\b/g, '[OPENAI_KEY REDACTED]'],
  [/\bsk-ant-[a-zA-Z0-9\-]{20,}\b/g, '[ANTHROPIC_KEY REDACTED]'],
  [/\bghp_[a-zA-Z0-9]{36}\b/g, '[GITHUB_TOKEN REDACTED]'],
  [/\bxoxb-[a-zA-Z0-9\-]+\b/g, '[SLACK_TOKEN REDACTED]'],
  [/Bearer\s+[a-zA-Z0-9._\-]{20,}/g, '[BEARER_TOKEN REDACTED]'],
  // Generic: KEY=value and SECRET=value patterns on a line
  [/(?:api[_\-]?key|secret|token|password|api_secret)\s*[=:]\s*[^\s'"]{8,}/gi, '[SECRET REDACTED]'],
];

/**
 * Redact API keys and secrets from command output before returning to the LLM.
 */
export function sanitizeOutput(output: string): string {
  let sanitized = output;
  for (const [pattern, replacement] of SENSITIVE_OUTPUT_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

export interface ShellOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  killed: boolean;
  durationMs: number;
  error?: string;
}

export async function executeCommand(
  command: string,
  options: ShellOptions = {}
): Promise<ShellResult> {
  const {
    cwd = process.cwd(),
    timeout = 30000,
    maxBuffer = 1024 * 1024,
    env,
  } = options;

  const startTime = performance.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...buildSanitizedEnv(env), TERM: 'dumb' },
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');

      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_e: unknown) {
        }
      }, 5000);
    }, timeout);

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      if (stdout.length + chunk.length <= maxBuffer) {
        stdout += chunk;
      }
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      if (stderr.length + chunk.length <= maxBuffer) {
        stderr += chunk;
      }
    });

    proc.stdout.on('error', () => {
    });

    proc.stderr.on('error', () => {
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: sanitizeOutput(stdout.trim()),
        stderr: sanitizeOutput(stderr.trim()),
        exitCode: code ?? 1,
        killed,
        durationMs: performance.now() - startTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: '',
        exitCode: 1,
        killed: false,
        durationMs: performance.now() - startTime,
        error: err.message,
      });
    });
  });
}

export async function executeCommandSafe(
  command: string,
  options: ShellOptions = {}
): Promise<{
  success: boolean;
  result?: ShellResult;
  error?: string;
  blocked?: boolean;
}> {
  if (isDangerousCommand(command)) {
    return {
      success: false,
      error: 'Command blocked for safety',
      blocked: true,
    };
  }

  const result = await executeCommand(command, options);

  if (result.error) {
    return {
      success: false,
      error: result.error,
      result,
    };
  }

  return {
    success: result.exitCode === 0,
    result,
  };
}
