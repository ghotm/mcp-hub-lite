import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isCliEntry } from '../../../src/cli/index.js';

describe('isCliEntry', () => {
  let tmpDir: string;
  let realEntry: string;
  let symlinkEntry: string;
  let otherFile: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'iscli-entry-'));
    // 模拟 npm 包安装后的真实入口文件
    realEntry = join(tmpDir, 'dist', 'server', 'src', 'cli', 'index.js');
    mkdirSync(join(tmpDir, 'dist', 'server', 'src', 'cli'), { recursive: true });
    writeFileSync(realEntry, '#!/usr/bin/env node\n');

    // 模拟 node_modules/.bin/mcp-hub-lite symlink → 真实入口
    symlinkEntry = join(tmpDir, 'node_modules', '.bin', 'mcp-hub-lite');
    mkdirSync(join(tmpDir, 'node_modules', '.bin'), { recursive: true });
    symlinkSync(realEntry, symlinkEntry);

    // 另一个无关文件（模拟"作为模块被 import"场景）
    otherFile = join(tmpDir, 'some-other-module.js');
    writeFileSync(otherFile, 'export default 1;\n');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return true when executed directly via the real entry path', () => {
    expect(isCliEntry(realEntry, pathToFileURL(realEntry).href)).toBe(true);
  });

  it('should return true when executed through the npm .bin symlink (Docker exec form)', () => {
    // argv[1] 是 symlink 路径，import.meta.url 是真实路径 —— 修复前此场景返回 false 导致静默退出
    expect(isCliEntry(symlinkEntry, pathToFileURL(realEntry).href)).toBe(true);
  });

  it('should return false when imported as a module (argv[1] is another file)', () => {
    expect(isCliEntry(otherFile, pathToFileURL(realEntry).href)).toBe(false);
  });

  it('should return false when argv[1] is undefined', () => {
    expect(isCliEntry(undefined, pathToFileURL(realEntry).href)).toBe(false);
  });

  it('should return false when the entry path does not exist', () => {
    expect(isCliEntry(join(tmpDir, 'does-not-exist.js'), pathToFileURL(realEntry).href)).toBe(
      false
    );
  });
});
