import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createLogger } from '@agntk/logger';
import { evaluateCapability } from './evaluator';
import type { EvalReport, CapabilityType } from './evaluator';

const log = createLogger('@agntk/core:harness-installer');

const TYPE_DIRS: Record<CapabilityType, string> = {
  rule: 'rules',
  instinct: 'instincts',
  skill: 'skills',
  workflow: 'workflows',
  unknown: 'misc',
};

export interface InstallResult {
  success: boolean;
  report: EvalReport;
  installedPath?: string;
  error?: string;
}

export async function installCapability(
  sourcePath: string,
  harnessRoot: string,
): Promise<InstallResult> {
  const report = await evaluateCapability(sourcePath);

  if (!report.passed) {
    log.warn('Capability validation failed', {
      path: sourcePath,
      failures: report.steps.filter((s) => s.status === 'fail').map((s) => s.message),
    });
    return { success: false, report, error: 'Validation failed — see report for details' };
  }

  const targetDir = join(harnessRoot, TYPE_DIRS[report.detectedType]);
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
  }

  const filename = basename(sourcePath);
  const targetPath = join(targetDir, filename);

  if (existsSync(targetPath)) {
    return { success: false, report, error: `File already exists at ${targetPath}` };
  }

  try {
    await copyFile(sourcePath, targetPath);
    log.info('Capability installed', {
      type: report.detectedType,
      source: sourcePath,
      target: targetPath,
    });
    return { success: true, report, installedPath: targetPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Installation failed', { error: message });
    return { success: false, report, error: message };
  }
}

export async function uninstallCapability(
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }

  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
    log.info('Capability uninstalled', { path: filePath });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
