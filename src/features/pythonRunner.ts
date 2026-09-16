/**
 * Python external runner bridge.
 * Executes legacy/custom python scripts with automatic autofix and live logs.
 */

import { spawn } from 'child_process';
import * as path from 'path';

export interface CommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
	spawnError?: Error;
}

export function runCommand(cmd: string, args: string[], cwd?: string): Promise<CommandResult> {
	return new Promise((resolve) => {
		let child: any;
		try {
			child = spawn(cmd, args, {
				cwd,
				windowsHide: true,
				env: Object.assign({}, process.env, {
					PYTHONIOENCODING: 'utf-8',
					PYTHONUTF8: '1',
				}),
			});
		} catch (err: any) {
			resolve({ spawnError: err, code: null, stdout: '', stderr: '' });
			return;
		}

		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (d: any) => { stdout += d.toString('utf8'); });
		child.stderr?.on('data', (d: any) => { stderr += d.toString('utf8'); });
		child.on('error', (err: any) => resolve({ spawnError: err, code: null, stdout, stderr }));
		child.on('close', (code: number | null) => resolve({ code, stdout, stderr }));
	});
}

export async function detectPython(): Promise<string[] | null> {
	const candidates: string[][] = process.platform === 'win32'
		? [['py', '-3'], ['python'], ['py'], ['python3']]
		: [['python3'], ['python']];

	for (const cand of candidates) {
		const res = await runCommand(cand[0]!, [...cand.slice(1), '--version']);
		if (!res.spawnError && res.code === 0) {
			return cand;
		}
	}
	return null;
}

export async function executePythonScript(
	scriptRelativePath: string,
	vaultRoot: string,
	onLog?: (msg: string) => void
): Promise<{ success: boolean; output: string }> {
	const pythonCmd = await detectPython();
	if (!pythonCmd) {
		throw new Error('Python is not installed or not found on this machine.');
	}

	const scriptAbs = path.join(vaultRoot, scriptRelativePath);
	if (onLog) onLog('Executing ' + pythonCmd.join(' ') + ' ' + scriptAbs);

	const res = await runCommand(pythonCmd[0]!, [...pythonCmd.slice(1), scriptAbs], vaultRoot);
	const combined = (res.stdout + '\n' + res.stderr).trim();

	if (res.code === 0) {
		return { success: true, output: combined };
	}

	return {
		success: false,
		output: 'Exit code ' + res.code + '\n' + combined,
	};
}