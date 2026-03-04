import {
  readFile,
  writeFile,
  appendFile,
  mkdir,
  readdir,
  rename,
  symlink,
  unlink,
  readlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '@agntk/logger';
import type { MemoryStore } from './types';

const log = createLogger('@agntk/core:memory-store');

const PROJECT_DIR_DEFAULT = '.agntk';
const GLOBAL_DIR_DEFAULT = '.agntk';

const DIRS = {
  memory: 'memory',
  workspace: 'workspace',
  archive: 'archive',
} as const;

const FILES = {
  identity: 'identity.md',
  preferences: 'preferences.md',
  project: 'project.md',
  context: 'context.md',
  decisions: 'decisions.md',
} as const;

const PROJECT_FALLBACKS = ['CLAUDE.md', 'AGENTS.md'] as const;

const CURRENT_SYMLINK = 'current';

export interface MarkdownMemoryStoreOptions {
  projectDir?: string;

  globalDir?: string;

  workspaceRoot?: string;
}

export class MarkdownMemoryStore implements MemoryStore {
  private readonly projectPath: string;
  private readonly globalPath: string;
  private readonly workspaceRoot: string;

  constructor(options: MarkdownMemoryStoreOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.projectPath = resolve(this.workspaceRoot, options.projectDir ?? PROJECT_DIR_DEFAULT);
    this.globalPath = resolve(homedir(), options.globalDir ?? GLOBAL_DIR_DEFAULT);
  }

  async loadIdentity(): Promise<string | null> {
    return this.readFileOrNull(join(this.globalPath, FILES.identity));
  }

  async loadPreferences(): Promise<string | null> {
    return this.readFileOrNull(join(this.globalPath, FILES.preferences));
  }

  async loadProject(): Promise<string | null> {
    const projectFile = await this.readFileOrNull(join(this.projectPath, FILES.project));
    if (projectFile) return projectFile;

    for (const fallback of PROJECT_FALLBACKS) {
      const content = await this.readFileOrNull(join(this.workspaceRoot, fallback));
      if (content) {
        log.debug('Using fallback project file', { file: fallback });
        return content;
      }
    }

    return null;
  }

  async loadContext(): Promise<string | null> {
    return this.readFileOrNull(join(this.projectPath, FILES.context));
  }

  async loadDecisions(): Promise<string | null> {
    return this.readFileOrNull(join(this.getMemoryPath(), FILES.decisions));
  }

  async saveContext(content: string): Promise<void> {
    await this.writeFileSafe(join(this.projectPath, FILES.context), content);
  }

  async savePreferences(content: string): Promise<void> {
    await this.writeFileSafe(join(this.globalPath, FILES.preferences), content);
  }

  async appendDecision(entry: string): Promise<void> {
    const filePath = join(this.getMemoryPath(), FILES.decisions);
    await this.ensureDir(this.getMemoryPath());
    const separator = existsSync(filePath) ? '\n\n' : '';
    await appendFile(filePath, separator + entry, 'utf-8');
    log.debug('Decision appended', { path: filePath });
  }

  async listMemoryFiles(): Promise<string[]> {
    const memoryDir = this.getMemoryPath();
    if (!existsSync(memoryDir)) return [];

    try {
      const entries = await readdir(memoryDir);
      return entries.filter((e) => e.endsWith('.md')).sort();
    } catch {
      return [];
    }
  }

  async createTaskFolder(label: string): Promise<string> {
    const workspaceDir = this.getWorkspacePath();
    await this.ensureDir(workspaceDir);

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\.\d+Z$/, '')
      .replace('T', 'T');
    const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const folderName = `${timestamp}-${safeLabel}`;
    const folderPath = join(workspaceDir, folderName);

    await mkdir(folderPath, { recursive: true });

    const symlinkPath = join(workspaceDir, CURRENT_SYMLINK);
    try {
      if (existsSync(symlinkPath)) {
        await unlink(symlinkPath);
      }
      await symlink(folderPath, symlinkPath);
    } catch (err) {
      log.warn('Failed to create current symlink', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    log.info('Task folder created', { path: folderPath });
    return folderPath;
  }

  async archiveTask(taskFolderName: string): Promise<void> {
    const sourcePath = join(this.getWorkspacePath(), taskFolderName);
    const destPath = join(this.getArchivePath(), taskFolderName);

    if (!existsSync(sourcePath)) {
      log.warn('Task folder not found for archival', { taskFolderName });
      return;
    }

    await this.ensureDir(this.getArchivePath());
    await rename(sourcePath, destPath);

    const symlinkPath = join(this.getWorkspacePath(), CURRENT_SYMLINK);
    try {
      if (existsSync(symlinkPath)) {
        const target = await readlink(symlinkPath);
        if (target === sourcePath || target === taskFolderName) {
          await unlink(symlinkPath);
        }
      }
    } catch {
      void 0;
    }

    log.info('Task archived', { from: sourcePath, to: destPath });
  }

  async getCurrentTaskPath(): Promise<string | null> {
    const symlinkPath = join(this.getWorkspacePath(), CURRENT_SYMLINK);
    try {
      if (!existsSync(symlinkPath)) return null;
      const target = await readlink(symlinkPath);

      if (!existsSync(target)) return null;
      return target;
    } catch {
      return null;
    }
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  getGlobalPath(): string {
    return this.globalPath;
  }

  getMemoryPath(): string {
    return join(this.projectPath, DIRS.memory);
  }

  getWorkspacePath(): string {
    return join(this.projectPath, DIRS.workspace);
  }

  getArchivePath(): string {
    return join(this.projectPath, DIRS.archive);
  }

  async ensureDirectories(): Promise<void> {
    await this.ensureDir(this.getMemoryPath());
    await this.ensureDir(this.getWorkspacePath());
    await this.ensureDir(this.getArchivePath());
    log.debug('Workspace directories ensured', { base: this.projectPath });
  }

  private async readFileOrNull(filePath: string): Promise<string | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return content.trim() || null;
    } catch {
      return null;
    }
  }

  private async writeFileSafe(filePath: string, content: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.ensureDir(dir);
    await writeFile(filePath, content, 'utf-8');
    log.debug('File written', { path: filePath, length: content.length });
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      log.debug('Directory created', { path: dir });
    }
  }
}
