export interface MemoryStore {
  loadIdentity(): Promise<string | null>;

  loadPreferences(): Promise<string | null>;

  loadProject(): Promise<string | null>;

  loadContext(): Promise<string | null>;

  loadDecisions(): Promise<string | null>;

  saveContext(content: string): Promise<void>;

  savePreferences(content: string): Promise<void>;

  appendDecision(entry: string): Promise<void>;

  listMemoryFiles(): Promise<string[]>;

  createTaskFolder(label: string): Promise<string>;

  archiveTask(taskFolderName: string): Promise<void>;

  getCurrentTaskPath(): Promise<string | null>;

  getProjectPath(): string;

  getGlobalPath(): string;

  getMemoryPath(): string;

  getWorkspacePath(): string;

  getArchivePath(): string;

  ensureDirectories(): Promise<void>;
}

export interface MemoryConfig {
  projectDir?: string;

  globalDir?: string;

  store?: MemoryStore;
}
