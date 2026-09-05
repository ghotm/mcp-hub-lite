#!/usr/bin/env node

/**
 * MCP Hub Lite CLI Entry Point
 * Implements 7 core commands: start, stop, status, ui, list, restart, tool-use
 */

import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { getAppVersion } from '@utils/version.js';
import { startCommand } from '@cli/commands/start.js';
import { stopCommand } from '@cli/commands/stop.js';
import { statusCommand } from '@cli/commands/status.js';
import { uiCommand } from '@cli/commands/ui.js';
import { listCommand } from '@cli/commands/list.js';
import { restartCommand } from '@cli/commands/restart.js';
import { toolUseCommand } from '@cli/commands/tool-use.js';
import { installCommand } from '@cli/commands/install.js';
import { useGuideCommand } from '@cli/commands/use-guide.js';

/**
 * Check if the CLI is being executed directly (vs imported as module).
 *
 * Compares the canonical (symlink-resolved) path of the executed entry
 * (`argv[1]`) against the real path of this module (`import.meta.url`).
 * This handles npm `.bin` shims: running `mcp-hub-lite` executes the
 * symlink at `node_modules/.bin/mcp-hub-lite`, while `import.meta.url`
 * points to the real file — resolving both via `realpathSync` makes them
 * comparable. Without this, the CLI silently exits without parsing args
 * when invoked through a symlink.
 *
 * @param entryPath - Optional override for tests; defaults to `argv[1]`.
 * @param moduleUrl - Optional override for tests; defaults to `import.meta.url`.
 */
export function isCliEntry(
  entryPath: string | undefined = argv[1],
  moduleUrl: string = import.meta.url
): boolean {
  if (!entryPath) {
    return false;
  }
  try {
    // Resolve symlinks: entryPath may be a npm .bin symlink while
    // moduleUrl is the real file path. Compare canonical paths.
    const currentReal = realpathSync(fileURLToPath(moduleUrl));
    const argvReal = realpathSync(entryPath);
    return currentReal === argvReal;
  } catch {
    return false;
  }
}

/**
 * Creates and configures the CLI application using Commander.js
 *
 * This function initializes the main CLI program with its name, description, and version,
 * then registers all available commands to provide a complete command-line interface
 * for managing the MCP Hub Lite service.
 *
 * The CLI provides seven core commands:
 * - start: Launches the MCP Hub Lite service in daemon or foreground mode
 * - stop: Gracefully terminates the running service instance
 * - status: Displays current service status including PID, port, host, and server count
 * - ui: Opens the web-based user interface in the default browser
 * - list: Shows all configured MCP servers in a tabular format
 * - restart: Stops and restarts the service with the same configuration
 * - tool-use: Manage MCP server tools via API (list-servers, list-tools, get-tool, call-tool)
 *
 * Usage examples:
 * ```bash
 * # Start service in daemon mode
 * mcp-hub-lite start
 *
 * # Start service in foreground mode on custom port
 * mcp-hub-lite start --port 8080 --foreground
 *
 * # Stop the running service
 * mcp-hub-lite stop
 *
 * # Check service status
 * mcp-hub-lite status
 *
 * # Open web UI
 * mcp-hub-lite ui
 *
 * # List all configured servers
 * mcp-hub-lite list
 *
 * # Restart the service
 * mcp-hub-lite restart
 * ```
 *
 * @returns {Command} The configured CLI program instance ready for parsing
 *
 * @example
 * ```typescript
 * const cli = createCli();
 * cli.parse(); // Parse command line arguments and execute
 * ```
 *
 * @see {@link startCommand} - Implementation of the start command
 * @see {@link stopCommand} - Implementation of the stop command
 * @see {@link statusCommand} - Implementation of the status command
 * @see {@link uiCommand} - Implementation of the ui command
 * @see {@link listCommand} - Implementation of the list command
 * @see {@link restartCommand} - Implementation of the restart command
 * @see {@link toolUseCommand} - Implementation of the tool-use command
 */
export function createCli(): Command {
  const program = new Command();

  program
    .name('mcp-hub-lite')
    .description('Lightweight MCP Gateway for managing MCP servers')
    .version(process.env.npm_package_version ?? getAppVersion(), '-v, --version');

  // Register all core commands
  program.addCommand(startCommand);
  program.addCommand(stopCommand);
  program.addCommand(statusCommand);
  program.addCommand(uiCommand);
  program.addCommand(listCommand);
  program.addCommand(restartCommand);
  program.addCommand(toolUseCommand);
  program.addCommand(installCommand);
  program.addCommand(useGuideCommand);

  return program;
}

// Execute the CLI if this file is run directly
if (isCliEntry()) {
  const cli = createCli();
  cli.parse();
}
