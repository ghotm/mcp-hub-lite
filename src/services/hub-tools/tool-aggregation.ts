import { hubManager } from '@services/hub-manager.service.js';
import type { Tool } from '@shared-models/tool.model.js';

/**
 * 应用 aggregatedTools 聚合白名单过滤（与 tool-list-generator 的 gatherRawToolData 语义一致）：
 * - 空数组/未配置 → 返回空数组（全部不可用，服务器工具不暴露）
 * - 非空 → 仅返回白名单内的工具
 *
 * @param serverName - 服务器名称（用于从 hubManager 读取 aggregatedTools 配置）
 * @param tools - 待过滤的工具列表（通常来自 mcpConnectionManager.getToolsByServerName）
 * @returns 过滤后的工具列表
 */
export function filterToolsByAggregation(serverName: string, tools: Tool[]): Tool[] {
  const serverConfig = hubManager.getServerByName(serverName);
  const aggregatedTools = serverConfig?.template?.aggregatedTools;
  if (!aggregatedTools?.length) {
    return [];
  }
  return tools.filter((t) => aggregatedTools.includes(t.name));
}
