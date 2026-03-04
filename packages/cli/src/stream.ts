import { createSpinner, summarizeArgs, summarizeOutput, formatDuration } from './ui';
import type { Colors } from './ui';
import type { OutputLevel } from './args';

interface StreamConsumerOptions {
  output: NodeJS.WritableStream;
  status: NodeJS.WritableStream;
  level: OutputLevel;
  colors: Colors;
  maxSteps?: number;
  isTTY?: boolean;
}

interface StreamStats {
  steps: number;
  toolCalls: number;
  startTime: number;
  inputTokens: number;
  outputTokens: number;
}

interface StreamResult {
  stats: StreamStats;
  streamError?: string;
}

export async function consumeStream(
  stream: AsyncIterable<{ type: string; [key: string]: unknown }>,
  opts: StreamConsumerOptions,
): Promise<StreamResult> {
  const { output, status, level, colors } = opts;
  const quiet = level === 'quiet';
  const verbose = level === 'verbose';
  const spinner = createSpinner(status, colors, !quiet && (opts.isTTY ?? false));

  const stats: StreamStats = {
    steps: 0,
    toolCalls: 0,
    startTime: Date.now(),
    inputTokens: 0,
    outputTokens: 0,
  };

  let afterToolResult = false;
  let currentStepStart = Date.now();
  let inReasoning = false;
  let hasTextOutput = false;
  let streamError: string | undefined;
  let lastToolOutput: string | null = null;
  let lastStepInputTokens = 0;
  let lastStepOutputTokens = 0;

  let inReflection = false;
  let reflectionBuffer = '';
  const REFLECTION_OPEN = '<reflection>';
  const REFLECTION_CLOSE = '</reflection>';

  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'start-step': {
        stats.steps++;
        currentStepStart = Date.now();
        if (!quiet) {
          status.write(
            `\n${colors.dim('──')} ${colors.blue(colors.bold(`step ${stats.steps}`))} ${colors.dim('──────────────────────────────────────')}\n`,
          );
        }
        break;
      }

      case 'finish-step': {
        if (reflectionBuffer && !inReflection) {
          if (reflectionBuffer.trim()) {
            if (afterToolResult && !quiet) {
              output.write('\n');
              afterToolResult = false;
            }
            hasTextOutput = true;
            output.write(reflectionBuffer);
          }
          reflectionBuffer = '';
        }
        inReflection = false;

        if (!quiet) {
          const elapsed = Date.now() - currentStepStart;
          const reason = (chunk.finishReason as string) ?? 'unknown';
          const usage = chunk.usage as { inputTokens?: number; outputTokens?: number } | undefined;
          const tokensIn = usage?.inputTokens ?? 0;
          const tokensOut = usage?.outputTokens ?? 0;
          lastStepInputTokens = tokensIn;
          lastStepOutputTokens = tokensOut;
          stats.inputTokens += tokensIn;
          stats.outputTokens += tokensOut;

          const parts = [
            colors.dim(`  ${formatDuration(elapsed)}`),
            `${colors.cyan(String(tokensIn))}${colors.dim('→')}${colors.cyan(String(tokensOut))} ${colors.dim('tok')}`,
          ];
          if (reason === 'tool-calls') {
            parts.push(colors.dim('→ tool loop'));
          } else if (reason === 'stop') {
            parts.push(colors.green(colors.bold('done')));
          } else {
            parts.push(colors.yellow(reason));
          }
          status.write(`${parts.join(colors.dim(' | '))}\n`);
        }
        break;
      }

      case 'reasoning-start': {
        if (!quiet) {
          inReasoning = true;
          status.write(colors.magenta('\n  💭 '));
        }
        break;
      }

      case 'reasoning-delta': {
        if (!quiet && inReasoning) {
          const text = (chunk.text as string) ?? '';
          const compacted = text.replace(/\n/g, ' ');
          status.write(colors.magenta(colors.dim(compacted)));
        }
        break;
      }

      case 'reasoning-end': {
        if (!quiet && inReasoning) {
          status.write('\n');
          inReasoning = false;
        }
        break;
      }

      case 'tool-call': {
        stats.toolCalls++;
        if (!quiet) {
          const toolName = chunk.toolName as string;
          if (verbose) {
            const argsStr = chunk.input ? JSON.stringify(chunk.input, null, 2) : '';
            status.write(`\n  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}\n`);
            if (argsStr) {
              const indented = argsStr
                .split('\n')
                .map((l) => `     ${l}`)
                .join('\n');
              status.write(`${colors.dim(indented)}\n`);
            }
          } else {
            const argsSummary = summarizeArgs(chunk.input, colors);
            const display = argsSummary
              ? `  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))} ${argsSummary}`
              : `  ${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}`;
            status.write(`${display}\n`);
          }
          spinner.start(`running ${toolName}...`);
        }
        afterToolResult = false;
        break;
      }

      case 'tool-result': {
        spinner.stop();
        const toolOutputRaw =
          typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output);
        try {
          const parsed = JSON.parse(toolOutputRaw);
          lastToolOutput =
            parsed && typeof parsed.output === 'string' ? parsed.output : toolOutputRaw;
        } catch {
          lastToolOutput = toolOutputRaw;
        }

        if (!quiet) {
          const toolName = chunk.toolName as string;
          if (verbose) {
            let displayOutput = lastToolOutput ?? '';
            const maxLen = 2000;
            if (displayOutput.length > maxLen) {
              displayOutput =
                displayOutput.slice(0, maxLen) + `\n... (${displayOutput.length} chars total)`;
            }
            const indented = displayOutput
              .split('\n')
              .map((l) => `     ${l}`)
              .join('\n');
            status.write(
              `  ${colors.green('✔')} ${colors.green(colors.dim(toolName))} ${colors.dim('returned')}\n`,
            );
            status.write(`${colors.dim(indented)}\n`);
          } else {
            const summary = summarizeOutput(chunk.output);
            const firstLine = summary.split('\n')[0]!;
            const truncated = firstLine.length > 100 ? firstLine.slice(0, 97) + '...' : firstLine;
            status.write(
              `  ${colors.green('✔')} ${colors.green(colors.dim(toolName + ': '))}${colors.dim(truncated)}\n`,
            );
          }
        }
        afterToolResult = true;
        break;
      }

      case 'tool-error': {
        spinner.stop();
        if (!quiet) {
          const toolName = chunk.toolName as string;
          const error =
            chunk.error instanceof Error
              ? chunk.error.message
              : String(chunk.error ?? 'unknown error');
          status.write(
            `  ${colors.red('✖')} ${colors.red(colors.bold(toolName))} ${colors.red(error)}\n`,
          );
        }
        afterToolResult = true;
        break;
      }

      case 'text-delta': {
        const rawText = (chunk.text as string) ?? '';
        if (!rawText) break;

        reflectionBuffer += rawText;

        while (reflectionBuffer.length > 0) {
          if (inReflection) {
            const closeIdx = reflectionBuffer.indexOf(REFLECTION_CLOSE);
            if (closeIdx !== -1) {
              const content = reflectionBuffer.slice(0, closeIdx);
              reflectionBuffer = reflectionBuffer.slice(closeIdx + REFLECTION_CLOSE.length);
              inReflection = false;

              if (verbose) {
                const trimmed = content.trim();
                if (trimmed) {
                  status.write(colors.dim(`  ... ${trimmed}\n`));
                }
              }
            } else {
              break;
            }
          } else {
            const openIdx = reflectionBuffer.indexOf(REFLECTION_OPEN);
            if (openIdx !== -1) {
              const before = reflectionBuffer.slice(0, openIdx);
              if (before) {
                if (afterToolResult && !quiet) {
                  output.write('\n');
                  afterToolResult = false;
                }
                if (before.trim()) hasTextOutput = true;
                output.write(before);
              }
              reflectionBuffer = reflectionBuffer.slice(openIdx + REFLECTION_OPEN.length);
              inReflection = true;
            } else {
              let partialAt = -1;
              for (
                let i = Math.max(0, reflectionBuffer.length - REFLECTION_OPEN.length);
                i < reflectionBuffer.length;
                i++
              ) {
                if (reflectionBuffer[i] === '<') {
                  const partial = reflectionBuffer.slice(i);
                  if (REFLECTION_OPEN.startsWith(partial)) {
                    partialAt = i;
                    break;
                  }
                }
              }

              if (partialAt !== -1) {
                const safe = reflectionBuffer.slice(0, partialAt);
                if (safe) {
                  if (afterToolResult && !quiet) {
                    output.write('\n');
                    afterToolResult = false;
                  }
                  if (safe.trim()) hasTextOutput = true;
                  output.write(safe);
                }
                reflectionBuffer = reflectionBuffer.slice(partialAt);
                break;
              } else {
                if (afterToolResult && !quiet) {
                  output.write('\n');
                  afterToolResult = false;
                }
                if (reflectionBuffer.trim()) hasTextOutput = true;
                output.write(reflectionBuffer);
                reflectionBuffer = '';
              }
            }
          }
        }
        break;
      }

      case 'finish': {
        spinner.stop();
        if (!quiet) {
          const elapsed = Date.now() - stats.startTime;
          const displayIn = lastStepInputTokens || stats.inputTokens;
          const displayOut = lastStepOutputTokens || stats.outputTokens;
          const stepLabel = `${stats.steps} step${stats.steps !== 1 ? 's' : ''}`;
          const toolLabel = `${stats.toolCalls} tool call${stats.toolCalls !== 1 ? 's' : ''}`;
          const tokLabel = `${colors.cyan(String(displayIn))}${colors.dim('→')}${colors.cyan(String(displayOut))} ${colors.dim('tok')}`;
          const timeLabel = colors.dim(formatDuration(elapsed));
          status.write(
            `\n${colors.dim('──')} ${colors.green(colors.bold('done'))} ${colors.dim('──')} ${colors.dim(stepLabel)} ${colors.dim('|')} ${colors.dim(toolLabel)} ${colors.dim('|')} ${tokLabel} ${colors.dim('|')} ${timeLabel} ${colors.dim('──')}\n`,
          );
        }
        break;
      }

      case 'error': {
        spinner.stop();
        const error =
          chunk.error instanceof Error
            ? chunk.error.message
            : String(chunk.error ?? 'unknown error');
        streamError = error;
        status.write(`\n${colors.red(colors.bold('✖ Error:'))} ${colors.red(error)}\n`);
        break;
      }

      default:
        break;
    }
  }

  const hitStepLimit = opts.maxSteps && opts.maxSteps > 0 && stats.steps >= opts.maxSteps;

  if (hitStepLimit && !quiet) {
    status.write(
      `\n${colors.yellow('Warning: step limit reached')} ${colors.dim(`(${opts.maxSteps} steps). Use --max-steps to increase.`)}\n`,
    );
  }

  if (!hasTextOutput && lastToolOutput && stats.toolCalls > 0 && !hitStepLimit) {
    if (!quiet) {
      output.write('\n');
    }
    output.write(lastToolOutput);
    if (!lastToolOutput.endsWith('\n')) {
      output.write('\n');
    }
  }

  return { stats, streamError };
}

interface SubAgentRendererOptions {
  status: NodeJS.WritableStream;
  colors: Colors;
  level: OutputLevel;
  isTTY: boolean;
}

const CLEAR_LINE = '\x1b[2K\r';

export function createSubAgentRenderer(opts: SubAgentRendererOptions) {
  const { status, colors, level } = opts;
  const quiet = level === 'quiet';
  const verbose = level === 'verbose';

  const agentSteps = new Map<string, number>();
  const agentToolCalls = new Map<string, number>();
  const announced = new Set<string>();

  return (data: {
    agentId: string;
    task: string;
    chunk: { type: string; [key: string]: unknown };
  }) => {
    if (quiet) return;

    const { agentId, task, chunk } = data;
    const prefix = colors.dim('  │ ');

    if (!announced.has(agentId)) {
      announced.add(agentSteps.has(agentId) ? agentId : agentId);
      agentSteps.set(agentId, 0);
      agentToolCalls.set(agentId, 0);
      if (opts.isTTY) status.write(CLEAR_LINE);
      const shortTask = task.length > 60 ? task.slice(0, 57) + '...' : task;
      status.write(
        `  ${colors.dim('┌─')} ${colors.magenta(colors.bold('sub-agent'))} ${colors.dim(agentId)} ${colors.dim('─')} ${colors.dim(shortTask)}\n`,
      );
    }

    switch (chunk.type) {
      case 'start-step': {
        const step = (agentSteps.get(agentId) ?? 0) + 1;
        agentSteps.set(agentId, step);
        status.write(`${prefix}${colors.dim('step ' + step)}\n`);
        break;
      }

      case 'tool-call': {
        const count = (agentToolCalls.get(agentId) ?? 0) + 1;
        agentToolCalls.set(agentId, count);
        const toolName = chunk.toolName as string;
        if (verbose) {
          status.write(`${prefix}${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}\n`);
        } else {
          const argsSummary = summarizeArgs(chunk.input, colors);
          const display = argsSummary
            ? `${prefix}${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))} ${argsSummary}`
            : `${prefix}${colors.cyan('▶')} ${colors.cyan(colors.bold(toolName))}`;
          status.write(`${display}\n`);
        }
        break;
      }

      case 'tool-result': {
        const toolName = chunk.toolName as string;
        const summary = summarizeOutput(chunk.output);
        const firstLine = summary.split('\n')[0]!;
        const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
        status.write(
          `${prefix}${colors.green('✔')} ${colors.green(colors.dim(toolName + ': '))}${colors.dim(truncated)}\n`,
        );
        break;
      }

      case 'tool-error': {
        const toolName = chunk.toolName as string;
        const error =
          chunk.error instanceof Error
            ? chunk.error.message
            : String(chunk.error ?? 'unknown error');
        status.write(
          `${prefix}${colors.red('✖')} ${colors.red(colors.bold(toolName))} ${colors.red(error)}\n`,
        );
        break;
      }

      case 'finish': {
        const steps = agentSteps.get(agentId) ?? 0;
        const tools = agentToolCalls.get(agentId) ?? 0;
        status.write(
          `  ${colors.dim('└─')} ${colors.green('done')} ${colors.dim(`(${steps} steps, ${tools} tool calls)`)}\n`,
        );
        break;
      }

      default:
        break;
    }
  };
}

export async function readStdin(timeoutMs: number = 100): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve(chunks.length === 0 ? null : Buffer.concat(chunks).toString('utf-8'));
    };

    process.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', finish);
    process.stdin.on('error', () => finish());
    setTimeout(finish, timeoutMs);
    process.stdin.resume();
  });
}
