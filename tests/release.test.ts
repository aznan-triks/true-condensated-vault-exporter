import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** Extract the workflow's own shell, not a second implementation of the guard. */
function stepRun(name: string): string {
	const marker = '      - name: ' + name + '\n';
	const start = workflow.indexOf(marker);
	if (start < 0) return '';
	const rest = workflow.slice(start + marker.length);
	const next = rest.search(/^      - /m);
	const step = next < 0 ? rest : rest.slice(0, next);
	const run = /^        run: (.*)\n?/m.exec(step);
	if (!run) return '';
	if (run[1] !== '|') return run[1] ?? '';
	return step.slice((run.index ?? 0) + run[0].length).replace(/^          /gm, '').trimEnd();
}

function execute(options: { checkExit?: number; assets?: string; overwrite?: boolean; exists?: boolean; listExit?: number; uploadExit?: number } = {}) {
	const dir = mkdtempSync(join(tmpdir(), 've-release-'));
	temporary.push(dir);
	const calls = join(dir, 'calls');
	const npm = join(dir, 'npm');
	writeFileSync(npm, '#!/usr/bin/env bash\nprintf "npm %s\\n" "$*" >> "$MOCK_CALLS"\nif [[ "$*" == "run check" ]]; then exit "${MOCK_CHECK_EXIT:-0}"; fi\n');
	const gh = join(dir, 'gh');
	writeFileSync(gh, `#!/usr/bin/env bash
printf 'gh %s\\n' "$*" >> "$MOCK_CALLS"
case "$1 $2" in
  'release view')
    if [[ "$MOCK_EXISTS" != true ]]; then exit 1; fi
    if [[ " $* " == *' --json assets '* ]]; then
      if [[ "$MOCK_LIST_EXIT" != 0 ]]; then exit "$MOCK_LIST_EXIT"; fi
      printf '%s\\n' "$MOCK_ASSETS"
    fi ;;
  'release create') exit 0 ;;
  'release upload') exit "$MOCK_UPLOAD_EXIT" ;;
  *) exit 90 ;;
esac
`);
	chmodSync(npm, 0o755);
	chmodSync(gh, 0o755);
	const shell = ['Verify', 'Build', 'Upload assets to release'].map(stepRun).filter(Boolean).join('\n').replaceAll('${{ steps.tag.outputs.tag }}', 'v-test');
	const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
		cwd: dir, encoding: 'utf8',
		env: { ...process.env, PATH: dir + ':' + process.env.PATH, TAG: 'v-test', GITHUB_REPOSITORY: 'example/test', OVERWRITE: String(options.overwrite ?? false), MOCK_CALLS: calls, MOCK_CHECK_EXIT: String(options.checkExit ?? 0), MOCK_EXISTS: String(options.exists ?? true), MOCK_ASSETS: options.assets ?? '', MOCK_LIST_EXIT: String(options.listExit ?? 0), MOCK_UPLOAD_EXIT: String(options.uploadExit ?? 0) },
	});
	return { ...result, calls: readFileSync(calls, 'utf8') };
}

describe('release gate (VE-015)', () => {
	it('runs the full check before build/upload on Node 22 with explicit default-false overwrite', () => {
		expect(stepRun('Verify')).toBe('npm run check');
		expect(workflow.indexOf('ref: ${{ steps.tag.outputs.tag }}')).toBeLessThan(workflow.indexOf('- name: Verify'));
		expect(workflow.indexOf('- name: Verify')).toBeLessThan(workflow.indexOf('- name: Build'));
		expect(workflow).toContain('node-version: "22"');
		expect(workflow).toMatch(/overwrite:\n\s+description:.*\n\s+required: false\n\s+type: boolean\n\s+default: false/);
	});
	it.each([1, 7])('never reaches publishing after a failed check (%s)', (checkExit) => {
		const result = execute({ checkExit });
		expect(result.status).toBe(checkExit);
		expect(result.calls).toContain('npm run check');
		expect(result.calls).not.toContain('gh release');
	});
	it('fails explicitly instead of overwriting an existing target asset by default', () => {
		const result = execute({ assets: 'main.js\nmanifest.json\nstyles.css' });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain('asset already exists');
		expect(result.stdout).toContain('overwrite=true');
		expect(result.calls).not.toContain('gh release upload');
	});
	it('allows clobber only with the explicit overwrite input', () => {
		const result = execute({ assets: 'main.js', overwrite: true });
		expect(result.status).toBe(0);
		expect(result.calls).toMatch(/gh release upload .*--clobber/);
	});
	it('creates a new release and uploads without clobber when no release exists', () => {
		const result = execute({ exists: false });
		expect(result.status).toBe(0);
		expect(result.calls).toContain('gh release create');
		expect(result.calls).toContain('gh release upload');
		expect(result.calls).not.toContain('--clobber');
	});
	it('allows missing target assets without overwriting unrelated assets', () => {
		const result = execute({ assets: 'notes.txt' });
		expect(result.status).toBe(0);
		expect(result.calls).toContain('gh release upload');
		expect(result.calls).not.toContain('--clobber');
	});
	it('fails closed when existing asset listing fails', () => {
		const result = execute({ listExit: 23 });
		expect(result.status).toBe(23);
		expect(result.calls).not.toContain('gh release upload');
	});
	it('does not mask an upload failure', () => {
		expect(execute({ uploadExit: 9 }).status).toBe(9);
	});
});
