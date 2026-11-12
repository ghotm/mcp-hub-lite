/**
 * Shared types for server detail components
 */

import type { ServerInstanceConfig } from '@shared-models/server.model';

/**
 * Instance configuration override interface
 */
export interface InstanceConfigOverrides {
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** 本地进程工作目录（覆盖模板级 cwd） */
  cwd?: string;
  proxy?: {
    url: string;
  };
  tags?: Record<string, string>;
  displayName?: string;
  enabled?: boolean;
}

/**
 * Extended instance interface with status information
 */
export interface InstanceWithStatus extends ServerInstanceConfig {
  status?: string;
  pid?: number;
  transportType?: string;
}
