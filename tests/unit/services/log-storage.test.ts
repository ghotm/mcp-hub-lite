/**
 * LogStorageService 单元测试
 *
 * 覆盖：
 * - append 保留原始文本（缩进/换行），不再 trim
 * - clearServerLogs 按 serverName 清除全部实例键，且不误删前缀相同的其他 server
 * - LOG_ENTRY 事件 payload 携带 serverName/serverIndex（兼容保留 serverId）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@services/event-bus.service.js', () => ({
  EventTypes: { LOG_ENTRY: 'log' },
  eventBus: { publish: vi.fn() }
}));

vi.mock('@utils/logger/index.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  },
  LOG_MODULES: {
    dynamic: vi.fn((id: string) => id)
  }
}));

import { LogStorageService } from '@services/log-storage.service.js';
import { eventBus, EventTypes } from '@services/event-bus.service.js';

describe('LogStorageService', () => {
  let storage: LogStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new LogStorageService();
  });

  describe('append()', () => {
    it('保留原始 message 的缩进与换行（不 trim）', () => {
      const message = '  line1\n\tline2  \n';
      const entry = storage.append('foo-0', 'info', message);

      expect(entry.message).toBe(message);
      expect(storage.getLogs('foo-0')[0]?.message).toBe(message);
    });

    it('允许空字符串入存储', () => {
      const entry = storage.append('foo-0', 'info', '');

      expect(entry.message).toBe('');
      expect(storage.getLogs('foo-0')).toHaveLength(1);
    });

    it('通知 listener 并遵守 maxLogs 上限', () => {
      const listener = vi.fn();
      storage.addLogListener('foo-0', listener);
      storage.setMaxLogsPerServer(2);

      storage.append('foo-0', 'info', 'a');
      storage.append('foo-0', 'info', 'b');
      storage.append('foo-0', 'info', 'c');

      expect(listener).toHaveBeenCalledTimes(3);
      expect(storage.getLogs('foo-0').map((log) => log.message)).toEqual(['b', 'c']);
    });
  });

  describe('clearServerLogs()', () => {
    it('清空同名 server 的所有实例键，且不影响前缀相同的其他 server', () => {
      storage.append('foo-0', 'info', 'a');
      storage.append('foo-1', 'info', 'b');
      storage.append('foobar-0', 'info', 'c');

      storage.clearServerLogs('foo');

      expect(storage.getLogs('foo-0')).toEqual([]);
      expect(storage.getLogs('foo-1')).toEqual([]);
      expect(storage.getLogs('foobar-0')).toHaveLength(1);
    });

    it('同时清空精确匹配的非复合键', () => {
      storage.append('foo', 'info', 'plain');
      storage.append('foo-0', 'info', 'instance');

      storage.clearServerLogs('foo');

      expect(storage.getLogCount('foo')).toBe(0);
      expect(storage.getLogCount('foo-0')).toBe(0);
    });

    it('server 名本身含 "-" 时按解析后的名字精确匹配', () => {
      storage.append('my-server-1-0', 'info', 'target');
      storage.append('my-server-0', 'info', 'other');

      storage.clearServerLogs('my-server-1');

      expect(storage.getLogCount('my-server-1-0')).toBe(0);
      expect(storage.getLogCount('my-server-0')).toBe(1);
    });
  });

  describe('LOG_ENTRY 事件', () => {
    it('payload 携带解析出的 serverName/serverIndex，并保留 serverId', () => {
      const entry = storage.append('foo-1', 'info', 'hello');

      expect(eventBus.publish).toHaveBeenCalledWith(EventTypes.LOG_ENTRY, {
        serverId: 'foo-1',
        serverName: 'foo',
        serverIndex: 1,
        logs: [entry]
      });
    });

    it('非复合键回退为 serverName=serverId、serverIndex=0', () => {
      const entry = storage.append('plain-name', 'info', 'hi');

      expect(eventBus.publish).toHaveBeenCalledWith(EventTypes.LOG_ENTRY, {
        serverId: 'plain-name',
        serverName: 'plain-name',
        serverIndex: 0,
        logs: [entry]
      });
    });
  });
});
