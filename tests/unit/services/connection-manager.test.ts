/**
 * McpConnectionManager session 失效自动恢复单元测试
 *
 * 测试策略：通过 vi.spyOn 隔离实例的 public connect/disconnect 方法，
 * 绕过真实 transport/连接逻辑，直接注入假 client 与 serverConfigCache 条目，
 * 专注验证 recoverSession 的语义（重连重试一次、连续失败计数、并发互斥等）。
 *
 * 私有字段在 TS 编译后为普通属性，测试中通过 (manager as any) 注入/断言，
 * 这是本项目可接受的测试手法。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getCompositeKey } from '@utils/composite-key.js';
import { McpConnectionManager } from '@services/connection/connection-manager.js';

// --- Mock 外部依赖，隔离真实 transport/连接逻辑 ---
vi.mock('@services/hub-manager.service.js', () => ({
  hubManager: {
    getServerByName: vi.fn(),
    getServerById: vi.fn(),
    getServerInstancesByName: vi.fn()
  }
}));

vi.mock('@services/event-bus.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/event-bus.service.js')>();
  return {
    ...actual,
    eventBus: {
      subscribe: vi.fn(),
      publish: vi.fn()
    }
  };
});

vi.mock('@utils/logger/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  LOG_MODULES: {
    CONNECTION_MANAGER: 'connection-manager'
  },
  formatMcpMessageForLogging: vi.fn(),
  logNotificationMessage: vi.fn()
}));

vi.mock('@utils/transports/transport-factory.js', () => ({
  TransportFactory: {
    createTransport: vi.fn()
  }
}));

import { hubManager } from '@services/hub-manager.service.js';

// --- 测试夹具常量 ---
const SERVER_NAME = 'test-server';
const SERVER_INDEX = 0;
const COMPOSITE_KEY = getCompositeKey(SERVER_NAME, SERVER_INDEX);
const TOOL_NAME = 'my-tool';
const TOOL_ARGS = { a: 1 };

/** 构造下游 session 失效错误（模拟 SDK StreamableHTTPClientTransport 抛出的包装错误） */
function sessionInvalidError(): StreamableHTTPError {
  return new StreamableHTTPError(
    400,
    'Error POSTing to endpoint: {"code":-32000,"message":"Bad Request: No valid session ID provided"}'
  );
}

describe('McpConnectionManager session 失效自动恢复', () => {
  let manager: McpConnectionManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverConfig: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpConnectionManager();
    fakeClient = {
      callTool: vi.fn(),
      close: vi.fn(),
      getServerVersion: vi.fn().mockReturnValue({ name: 'fake', version: '1.0.0' }),
      getServerCapabilities: vi.fn()
    };
    serverConfig = {
      id: 'test-server-instance',
      type: 'streamable-http',
      url: 'http://localhost:9999/mcp',
      name: SERVER_NAME,
      timeout: 30000
    };
    // 注入假 client 与配置缓存（模拟 connect() 成功后的状态）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).clients.set(COMPOSITE_KEY, fakeClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (manager as any).serverConfigCache.set(COMPOSITE_KEY, serverConfig);
    // hubManager.getServerByName 默认返回 undefined → requestTimeout 为 undefined
    vi.mocked(hubManager.getServerByName).mockReturnValue(undefined);
  });

  describe('用例 1：session 失效 → 自动重连成功 → 重试一次原调用', () => {
    it('首次调用抛 session 失效错误，disconnect+connect 后重试成功并返回结果', async () => {
      const connectSpy = vi.spyOn(manager, 'connect').mockResolvedValue(true);
      const disconnectSpy = vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      const expected = { content: [{ type: 'text', text: 'ok' }] };
      fakeClient.callTool
        .mockRejectedValueOnce(sessionInvalidError())
        .mockResolvedValueOnce(expected);

      const result = await manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS);

      expect(result).toEqual(expected);
      expect(fakeClient.callTool).toHaveBeenCalledTimes(2);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy).toHaveBeenCalledTimes(1);
      // 重连使用缓存配置重建
      expect(connectSpy).toHaveBeenCalledWith(SERVER_NAME, SERVER_INDEX, serverConfig);
      // 重连成功后连续失败计数清零
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).consecutiveReconnectFailures.has(COMPOSITE_KEY)).toBe(false);
    });
  });

  describe('用例 2：连续重连失败计数跨调用累计，达到阈值后放弃', () => {
    it('前两次抛"第N次"错误，第 3 次抛最终错误，之后重新累计', async () => {
      const connectSpy = vi.spyOn(manager, 'connect').mockResolvedValue(false);
      vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      // 每次 callTool 首次调用均抛 session 失效错误
      fakeClient.callTool.mockRejectedValue(sessionInvalidError());

      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 1/3 次）');
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 2/3 次）');
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('连续重连失败 3 次，放弃自动恢复');
      expect(connectSpy).toHaveBeenCalledTimes(3);

      // 已达阈值后计数清除：下一次重新从第 1 次开始累计
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 1/3 次）');
      expect(connectSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('用例 3：重连成功后计数清零', () => {
    it('失败 2 次后重连成功 → 计数清零，之后再次 session 失效仍走恢复流程', async () => {
      vi.spyOn(manager, 'connect')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        // 持续默认值：后续调用（第四次及以后）均返回 false，避免回落真实 connect()
        .mockResolvedValue(false);
      vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      const expected = { content: [{ type: 'text', text: 'recovered' }] };
      // 精确 mock 序列：前三次 callTool 首次调用抛错，第三次重试成功，第四次首次抛错
      fakeClient.callTool
        .mockRejectedValueOnce(sessionInvalidError())
        .mockRejectedValueOnce(sessionInvalidError())
        .mockRejectedValueOnce(sessionInvalidError())
        .mockResolvedValueOnce(expected)
        .mockRejectedValueOnce(sessionInvalidError());

      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 1/3 次）');
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 2/3 次）');

      // 第三次：重连成功 → 重试成功 → 计数清零
      const result = await manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS);
      expect(result).toEqual(expected);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).consecutiveReconnectFailures.has(COMPOSITE_KEY)).toBe(false);

      // 之后再次 session 失效 → 仍进入恢复流程（从第 1 次重新累计，而非直接抛最终错误）
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('自动重连失败（第 1/3 次）');
    });
  });

  describe('用例 4：非 session 失效错误保持原行为', () => {
    it('普通错误原样 rethrow，不触发 disconnect/connect', async () => {
      const connectSpy = vi.spyOn(manager, 'connect').mockResolvedValue(true);
      const disconnectSpy = vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      fakeClient.callTool.mockRejectedValue(new Error('Some other error'));

      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('Some other error');
      expect(fakeClient.callTool).toHaveBeenCalledTimes(1);
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
    });
  });

  describe('用例 5：并发互斥保护', () => {
    it('同一连接重连进行中，并发调用抛"正在重连"且不重复触发重连', async () => {
      // connect 挂起直到手动放行，模拟慢速重连
      let resolveConnect: ((v: boolean) => void) | undefined;
      const connectSpy = vi.spyOn(manager, 'connect').mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveConnect = resolve;
          })
      );
      const disconnectSpy = vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      fakeClient.callTool.mockRejectedValue(sessionInvalidError());

      const firstCall = manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS);

      // 等待第一个恢复流程进入 connect（此时 reconnectingKeys 已包含该 key）
      await vi.waitFor(() => {
        expect(connectSpy).toHaveBeenCalledTimes(1);
      });

      // 并发第二次调用 → 抛"正在重连"错误，且不重复触发重连
      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('正在重连，请稍后重试');
      expect(connectSpy).toHaveBeenCalledTimes(1);

      // 放行第一个恢复流程：重连成功 → 重试一次并返回结果
      const expected = { content: [{ type: 'text', text: 'ok' }] };
      fakeClient.callTool.mockResolvedValueOnce(expected);
      resolveConnect?.(true);
      await expect(firstCall).resolves.toEqual(expected);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('兜底：无缓存配置', () => {
    it('session 失效但无缓存配置时抛明确错误，不进行重连', async () => {
      const connectSpy = vi.spyOn(manager, 'connect').mockResolvedValue(true);
      const disconnectSpy = vi.spyOn(manager, 'disconnect').mockResolvedValue(undefined);
      fakeClient.callTool.mockRejectedValue(sessionInvalidError());
      // 移除配置缓存（模拟极端情况）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).serverConfigCache.delete(COMPOSITE_KEY);

      await expect(
        manager.callTool(SERVER_NAME, SERVER_INDEX, TOOL_NAME, TOOL_ARGS)
      ).rejects.toThrow('session 失效且无缓存配置，无法自动重连');
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect(connectSpy).not.toHaveBeenCalled();
    });
  });
});
