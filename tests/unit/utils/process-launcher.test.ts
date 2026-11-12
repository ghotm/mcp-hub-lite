import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ProcessLauncher } from '../../../src/utils/process-launcher.js';

// eslint-disable-next-line no-var
var mockChildProcess = Object.assign(new EventEmitter(), {
  pid: 12345,
  stderr: new EventEmitter(),
  stdout: new EventEmitter(),
  stdin: new EventEmitter(),
  kill: vi.fn(() => {
    mockChildProcess.emit('exit', 0, 'SIGTERM');
  })
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChildProcess)
}));

describe('ProcessLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChildProcess.removeAllListeners();
    mockChildProcess.stderr.removeAllListeners();
    mockChildProcess.stdout.removeAllListeners();
    mockChildProcess.kill = vi.fn(() => {
      mockChildProcess.emit('exit', 0, 'SIGTERM');
    });
  });

  describe('launch()', () => {
    it('should spawn a child process and return a handle', async () => {
      const { spawn } = await import('node:child_process');
      const proc = ProcessLauncher.launch({
        command: 'uvx',
        args: ['server', '--http'],
        env: { PORT: '3333' }
      });

      expect(spawn).toHaveBeenCalledWith('uvx', ['server', '--http'], {
        env: expect.objectContaining({ PORT: '3333' }),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      expect(proc.pid).toBe(12345);
      expect(proc.stderr).toBeDefined();
      expect(proc.stdout).toBeDefined();
    });

    it('should emit stderr data through the returned stream', () => {
      const proc = ProcessLauncher.launch({
        command: 'node',
        args: ['test.js']
      });

      const chunks: string[] = [];
      proc.stderr.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString());
      });

      mockChildProcess.stderr.emit('data', Buffer.from('hello\n'));
      mockChildProcess.stderr.emit('data', Buffer.from('world\n'));

      expect(chunks).toEqual(['hello\n', 'world\n']);
    });

    it('should emit stdout data through the returned stream', () => {
      const proc = ProcessLauncher.launch({
        command: 'uvx',
        args: ['server', '--http']
      });

      const chunks: string[] = [];
      proc.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk.toString());
      });

      mockChildProcess.stdout.emit('data', Buffer.from('  server started\n'));
      mockChildProcess.stdout.emit('data', Buffer.from('\tlistening on 3333\n'));

      expect(chunks).toEqual(['  server started\n', '\tlistening on 3333\n']);
    });

    it('should pass cwd to spawn when configured', async () => {
      const { spawn } = await import('node:child_process');
      ProcessLauncher.launch({
        command: 'node',
        args: ['server.js'],
        cwd: '/tmp/opencode'
      });

      expect(spawn).toHaveBeenCalledWith(
        'node',
        ['server.js'],
        expect.objectContaining({ cwd: '/tmp/opencode' })
      );
    });

    it('should throw immediately when spawn fails (pid undefined)', () => {
      (mockChildProcess as { pid?: number }).pid = undefined;

      expect(() => ProcessLauncher.launch({ command: 'missing', args: [] })).toThrow(
        'Failed to spawn "missing"'
      );

      (mockChildProcess as { pid?: number }).pid = 12345;
    });

    it('should end the stdout stream when the process exits', () => {
      const proc = ProcessLauncher.launch({
        command: 'node',
        args: ['test.js']
      });

      mockChildProcess.emit('exit', 0, null);

      expect((proc.stdout as PassThrough).writableEnded).toBe(true);
      expect((proc.stderr as PassThrough).writableEnded).toBe(true);
    });
  });

  describe('stop()', () => {
    it('should send SIGTERM and wait for exit', async () => {
      const proc = ProcessLauncher.launch({
        command: 'node',
        args: ['test.js']
      });

      const stopPromise = proc.stop();
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate exit event
      setImmediate(() => mockChildProcess.emit('exit', 0, 'SIGTERM'));

      await stopPromise;
    });

    it('should resolve immediately if process already exited', async () => {
      const proc = ProcessLauncher.launch({
        command: 'node',
        args: ['test.js']
      });

      mockChildProcess.emit('exit', 0, null);

      await proc.stop();
      // kill should not be called since process already exited
    });
  });

  describe('waitForReady()', () => {
    it('should resolve when pattern matches in stderr', async () => {
      const stderr = new PassThrough();

      const readyPromise = ProcessLauncher.waitForReady(stderr, ['listening on'], 1000);
      stderr.write(Buffer.from('Server listening on port 3333\n'));

      await expect(readyPromise).resolves.toBeUndefined();
    });

    it('should reject on timeout if no pattern matches', async () => {
      const stderr = new PassThrough();

      const readyPromise = ProcessLauncher.waitForReady(stderr, ['listening on'], 100);
      stderr.write(Buffer.from('some unrelated output\n'));

      await expect(readyPromise).rejects.toThrow('Server did not emit any ready pattern');
    });

    it('should resolve immediately when patterns array is empty', async () => {
      const stderr = new PassThrough();
      await expect(ProcessLauncher.waitForReady(stderr, [], 100)).resolves.toBeUndefined();
    });
  });
});
