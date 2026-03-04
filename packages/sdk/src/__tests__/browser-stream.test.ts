import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserStreamEmitter, createBrowserStream } from '../tools/browser/stream';

vi.mock('../tools/browser/tool', () => ({
  isBrowserCliAvailable: vi.fn(),
  executeBrowserCommand: vi.fn(),
  buildCommand: vi.fn((...args: unknown[]) => ['mock-command', ...String(args[0]).split(',')]),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

vi.mock('node:path', () => ({
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

import { isBrowserCliAvailable, executeBrowserCommand, buildCommand } from '../tools/browser/tool';

const mockIsBrowserCliAvailable = vi.mocked(isBrowserCliAvailable);
const mockExecuteBrowserCommand = vi.mocked(executeBrowserCommand);
const mockBuildCommand = vi.mocked(buildCommand);

describe('BrowserStreamEmitter', () => {
  let emitter: BrowserStreamEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockIsBrowserCliAvailable.mockResolvedValue(true);
    mockExecuteBrowserCommand.mockResolvedValue({
      stdout: 'screenshot saved',
      stderr: '',
      exitCode: 0,
      durationMs: 100,
    });
    mockBuildCommand.mockReturnValue(['screenshot', '/tmp/test.png']);
  });

  afterEach(() => {
    emitter?.stop();
    vi.useRealTimers();
  });

  describe('createBrowserStream factory', () => {
    it('should create a BrowserStreamEmitter instance', () => {
      emitter = createBrowserStream();
      expect(emitter).toBeInstanceOf(BrowserStreamEmitter);
    });

    it('should accept custom config', () => {
      emitter = createBrowserStream({ fps: 5, quality: 80 });
      const config = emitter.getConfig();
      expect(config.fps).toBe(5);
      expect(config.quality).toBe(80);
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      emitter = new BrowserStreamEmitter();
      const config = emitter.getConfig();
      expect(config.fps).toBe(2);
      expect(config.quality).toBe(60);
      expect(config.width).toBe(1280);
      expect(config.height).toBe(720);
    });

    it('should clamp FPS to valid range', () => {
      emitter = new BrowserStreamEmitter({ fps: 100 });
      expect(emitter.getConfig().fps).toBe(10);

      emitter = new BrowserStreamEmitter({ fps: 0 });
      expect(emitter.getConfig().fps).toBe(0.5);
    });

    it('should clamp quality to valid range', () => {
      emitter = new BrowserStreamEmitter({ quality: 200 });
      expect(emitter.getConfig().quality).toBe(100);

      emitter = new BrowserStreamEmitter({ quality: -10 });
      expect(emitter.getConfig().quality).toBe(1);
    });

    it('should update config via setConfig', () => {
      emitter = new BrowserStreamEmitter();
      emitter.setConfig({ fps: 5, quality: 90 });
      const config = emitter.getConfig();
      expect(config.fps).toBe(5);
      expect(config.quality).toBe(90);
    });

    it('should allow partial config updates', () => {
      emitter = new BrowserStreamEmitter({ fps: 3, quality: 70 });
      emitter.setConfig({ fps: 8 });
      const config = emitter.getConfig();
      expect(config.fps).toBe(8);
      expect(config.quality).toBe(70);
    });
  });

  describe('lifecycle', () => {
    it('should not be running initially', () => {
      emitter = new BrowserStreamEmitter();
      expect(emitter.isRunning()).toBe(false);
    });

    it('should emit started event on start', async () => {
      emitter = new BrowserStreamEmitter();
      const startedSpy = vi.fn();
      emitter.on('started', startedSpy);

      await emitter.start();

      expect(emitter.isRunning()).toBe(true);
      expect(startedSpy).toHaveBeenCalledWith(expect.objectContaining({ fps: 2, quality: 60 }));
    });

    it('should emit error if CLI is not available', async () => {
      mockIsBrowserCliAvailable.mockResolvedValue(false);
      emitter = new BrowserStreamEmitter();
      const errorSpy = vi.fn();
      emitter.on('error', errorSpy);

      await emitter.start();

      expect(emitter.isRunning()).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('agent-browser CLI not found'));
    });

    it('should emit stopped event on stop', async () => {
      emitter = new BrowserStreamEmitter();
      const stoppedSpy = vi.fn();
      emitter.on('stopped', stoppedSpy);

      await emitter.start();
      emitter.stop();

      expect(emitter.isRunning()).toBe(false);
      expect(stoppedSpy).toHaveBeenCalled();
    });

    it('should be idempotent for start/stop', async () => {
      emitter = new BrowserStreamEmitter();
      const startedSpy = vi.fn();
      emitter.on('started', startedSpy);

      await emitter.start();
      await emitter.start();

      expect(startedSpy).toHaveBeenCalledTimes(1);

      emitter.stop();
      emitter.stop();
    });
  });

  describe('input injection', () => {
    beforeEach(() => {
      emitter = new BrowserStreamEmitter();
    });

    it('should inject click events', async () => {
      const result = await emitter.injectInput({ type: 'click', x: 100, y: 200 });
      expect(result.success).toBe(true);
      expect(mockExecuteBrowserCommand).toHaveBeenCalled();
    });

    it('should inject press events', async () => {
      const result = await emitter.injectInput({ type: 'press', key: 'Enter' });
      expect(result.success).toBe(true);
      expect(mockBuildCommand).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'press', key: 'Enter' }),
        expect.any(Object),
      );
    });

    it('should inject scroll events', async () => {
      const result = await emitter.injectInput({
        type: 'scroll',
        direction: 'down',
        pixels: 300,
      });
      expect(result.success).toBe(true);
    });

    it('should inject type events with selector', async () => {
      const result = await emitter.injectInput({
        type: 'type',
        text: 'hello',
        selector: '#input',
      });
      expect(result.success).toBe(true);
    });

    it('should inject fill events', async () => {
      const result = await emitter.injectInput({
        type: 'fill',
        selector: '#search',
        text: 'test query',
      });
      expect(result.success).toBe(true);
    });

    it('should emit input-ack event', async () => {
      const ackSpy = vi.fn();
      emitter.on('input-ack', ackSpy);

      await emitter.injectInput({ type: 'click', x: 50, y: 50 });

      expect(ackSpy).toHaveBeenCalledWith('click', true, undefined);
    });

    it('should handle failed injection', async () => {
      mockExecuteBrowserCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Element not found',
        exitCode: 1,
        durationMs: 50,
      });

      const result = await emitter.injectInput({ type: 'click', x: 0, y: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Element not found');
    });

    it('should handle injection errors', async () => {
      mockExecuteBrowserCommand.mockRejectedValue(new Error('Command failed'));

      const result = await emitter.injectInput({ type: 'press', key: 'Tab' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed');
    });
  });

  describe('frame capture', () => {
    it('should emit frame events when running', async () => {
      emitter = new BrowserStreamEmitter({ fps: 2 });
      const frameSpy = vi.fn();
      emitter.on('frame', frameSpy);

      await emitter.start();

      await vi.advanceTimersByTimeAsync(600);

      expect(frameSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(String),
          timestamp: expect.any(Number),
          sequence: 0,
        }),
      );

      emitter.stop();
    });

    it('should emit error on screenshot failure', async () => {
      mockExecuteBrowserCommand.mockResolvedValue({
        stdout: '',
        stderr: 'Browser not running',
        exitCode: 1,
        durationMs: 50,
      });

      emitter = new BrowserStreamEmitter({ fps: 2 });
      const errorSpy = vi.fn();
      emitter.on('error', errorSpy);

      await emitter.start();
      await vi.advanceTimersByTimeAsync(600);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Screenshot capture failed'));

      emitter.stop();
    });

    it('should stop emitting frames after stop', async () => {
      emitter = new BrowserStreamEmitter({ fps: 2 });
      const frameSpy = vi.fn();
      emitter.on('frame', frameSpy);

      await emitter.start();
      await vi.advanceTimersByTimeAsync(600);

      const callCount = frameSpy.mock.calls.length;
      emitter.stop();

      await vi.advanceTimersByTimeAsync(2000);

      expect(frameSpy.mock.calls.length).toBe(callCount);
    });
  });

  describe('stream end on close', () => {
    it('should clean up when stopped', async () => {
      emitter = new BrowserStreamEmitter();
      await emitter.start();

      expect(emitter.isRunning()).toBe(true);
      emitter.stop();
      expect(emitter.isRunning()).toBe(false);
    });
  });
});
