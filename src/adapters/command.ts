import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CommandOptions {
  cwd: string;
  timeoutMs: number;
}

export interface CommandRunner {
  run(executable: string, args: string[], options: CommandOptions): Promise<void>;
}

export const systemCommandRunner: CommandRunner = {
  async run(executable, args, options) {
    await execFileAsync(executable, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', PYTHONIOENCODING: 'utf-8' },
    });
  },
};
