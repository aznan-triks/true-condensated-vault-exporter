#!/usr/bin/env node
/**
 * Mock-Obsidian smoke test.
 *
 * Loads the production bundle (main.js) exactly like Obsidian does — through a
 * CommonJS loader with `obsidian` and `electron` provided by the host — and
 * drives it in jsdom against a real temporary vault: plugin load, sidebar,
 * settings tab, every export target, cancellation and the reveal shortcut.
 *
 * Usage:  npm run smoke        (builds nothing; run `npm run build` first)
 *         node tools/mock-obsidian/run.js [--vault <dir>] [--keep]
 *
 * The mocks under this folder deliberately mirror the *declared* API surface
 * (manifest.minAppVersion) — an API Obsidian does not have fails here.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const vaultArgIndex = args.indexOf('--vault');
const bundleArgIndex = args.indexOf('--bundle');
const VAULT = vaultArgIndex >= 0 ? path.resolve(args[vaultArgIndex + 1]) : path.join(os.tmpdir(), 'vault-exporter-smoke');
const KEEP = args.includes('--keep');

const notRun = (message) => { console.error(message); process.exit(2); };

const BUNDLE = bundleArgIndex >= 0 ? path.resolve(args[bundleArgIndex + 1]) : path.join(ROOT, 'main.js');
if (!fs.existsSync(BUNDLE)) notRun('main.js not found — run `npm run build` first.');
// A downloaded release keeps its own manifest next to the bundle.
const bundleDir = path.dirname(BUNDLE);
const manifestPath = fs.existsSync(path.join(bundleDir, 'manifest.json')) ? path.join(bundleDir, 'manifest.json') : path.join(ROOT, 'manifest.json');
const MANIFEST = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// -------------------------------------------------------------- jsdom setup
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'app://obsidian.md/index.html', pretendToBeVisual: true });
const { window } = dom;
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
	global[key] = window[key] ?? window[key.toLowerCase?.()];
}
global.window = window;
global.document = window.document;
global.getComputedStyle = window.getComputedStyle.bind(window);
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
require('./dom-helpers.cjs').install(window);

const obsidianMock = require('./obsidian-mock.cjs');

// Obsidian's renderer provides CommonJS `require` on the window; the plugin's
// Electron lookup goes through it.
window.require = (id) => {
	if (id === 'obsidian') return obsidianMock;
	if (id === 'electron') return require('./electron-mock.cjs');
	return require(id);
};

// ------------------------------------------------- loading the real bundle
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
	if (request === 'obsidian') return require.resolve('./obsidian-mock.cjs');
	if (request === 'electron') return require.resolve('./electron-mock.js');
	return originalResolve.call(this, request, ...rest);
};

function loadPluginClass() {
	// The repo is `"type": "module"`, so the CJS bundle cannot be `require`d by
	// path; compile it into a CommonJS module exactly like Obsidian does.
	const source = fs.readFileSync(BUNDLE, 'utf8');
	const mod = new Module(BUNDLE, null);
	mod.filename = BUNDLE;
	mod.paths = Module._nodeModulePaths(path.dirname(BUNDLE));
	mod._compile(source, BUNDLE);
	const exported = mod.exports;
	return exported.default ?? exported;
}

// ---------------------------------------------------------------- utilities
const stderrWrite = (message) => process.stderr.write(String(message) + '\n');
const results = [];
function record(name, ok, detail = '') {
	results.push({ name, ok: Boolean(ok), detail: String(detail ?? '') });
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeFixture(root) {
	const write = (rel, content) => {
		const full = path.join(root, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, content, 'utf8');
	};
	write('Projects/Alpha.md', [
		'---', 'tags: [project, alpha]', 'status: done', 'cssclasses: [wide]', '---',
		'# Alpha', '', 'Body of Alpha with [[Beta]] and #project.', '',
		'%%internal comment%%', '', 'Embedded note: ![[Beta]]', 'Embedded image: ![[Assets/pic.png]]', '', 'Inline `code with %% kept`.', '',
		'```python', 'print("hi") # not a heading', '```', '',
		'## Tasks', '- [ ] one', '',
	].join('\n'));
	write('Projects/Beta.md', '---\ntags: [project]\nstatus: done\n---\n# Beta\n\nBeta links to [[Alpha|the alpha note]]. #project\n');
	write('Dataview/Projects.md', [
		'```dataview', 'TABLE status FROM "Projects" WHERE status = "done" SORT file.name ASC', '```', '',
		'```dataviewjs', 'const x = 1;', '```', '',
	].join('\n'));
	write('Knowledge Base/Note.md', '# Note\n\nA note in a folder with a space.\n');
	write('.hidden/Secret.md', '# Secret\n\nHidden folder.\n');
	write('Assets/pic.canvas', JSON.stringify({ nodes: [{ type: 'file', file: 'Projects/Alpha.md' }], edges: [] }));
	write('.obsidian/plugins/vault-exporter/data.json', '{"settings":{"documentTitle":"internal"}}');
}

async function buildPlugin() {
	const { makeVault } = require('./app-mock.cjs');
	const { app } = makeVault(VAULT);
	app.containerEl = window.document.body.createDiv({ cls: 'app-container' });
	// Mirrors the app-level settings modal, including two behaviours reported on
	// real installs: `open()` renders asynchronously, and `openTabById` is
	// ignored until the render finished. A settings shortcut must therefore wait
	// and retry instead of firing once and hoping.
	app.setting = {
		tabs: [],
		isOpen: false,
		activeTab: null,
		open() {
			return new Promise((resolve) => setTimeout(() => { this.isOpen = true; resolve(); }, 5));
		},
		openTabById(id) {
			if (!this.isOpen) return;
			this.lastTabId = id;
			this.activeTab = id;
		},
	};
	const PluginClass = loadPluginClass();
	const plugin = new PluginClass(app, MANIFEST);
	app.pluginViews = plugin._views;
	app.viewRegistry = plugin._views;
	await plugin.onload();
	return { app, plugin };
}

function panelStatus() {
	const el = window.document.querySelector('.ve-panel__status');
	return el ? el.textContent : null;
}
function panelText() {
	const el = window.document.querySelector('.ve-panel');
	return el ? el.textContent : '';
}
async function waitFinished(timeoutMs = 60000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const status = panelStatus();
		if (status && ['Done', 'Cancelled', 'Failed'].includes(status)) return status;
		await sleep(10);
	}
	return 'TIMEOUT';
}
const out = (rel) => fs.readFileSync(path.join(VAULT, rel), 'utf8');
const has = (rel) => fs.existsSync(path.join(VAULT, rel));

// ----------------------------------------------------------------- scenarios
(async () => {
	console.log(`bundle: ${BUNDLE} (${fs.statSync(BUNDLE).size} bytes, manifest ${MANIFEST.id}@${MANIFEST.version})`);
	console.log(`vault:  ${VAULT}`);

	const consoleErrors = [];
	const consoleWarnings = [];
	const realError = console.error.bind(console);
	const realWarn = console.warn.bind(console);
	stderrWrite('');
	console.error = (...a) => consoleErrors.push(a.map(String).join(' '));
	console.warn = (...a) => consoleWarnings.push(a.map(String).join(' '));
	process.on('unhandledRejection', (error) => realError('unhandledRejection', error));

	fs.rmSync(VAULT, { recursive: true, force: true });
	writeFixture(VAULT);
	const { plugin } = await buildPlugin();
	const { default: noop } = { default: null };
	void noop;

	console.log('\n--- plugin load ---');
	record('plugin id from manifest', plugin.manifest.id === 'vault-exporter', plugin.manifest.id);
	record('10 commands registered', plugin._commands.length === 10, plugin._commands.map((c) => c.id).join(', '));
	record('settings shortcut command registered', plugin._commands.some((c) => c.id === 'open-settings'));
	record('settings tab registered', plugin._settingTabs.length === 1);
	record('sidebar view registered', plugin._views.has('vault-exporter-sidebar'));
	record('ribbon icon registered', plugin._ribbonIcons.length === 1, plugin._ribbonIcons[0]?.icon);
	record('no console errors during load', consoleErrors.length === 0, consoleErrors.join(' | '));

	console.log('\n--- sidebar ---');
	let openError = null;
	try {
		await plugin.activateSidebarView();
	} catch (error) {
		openError = error;
	}
	const leaf = plugin.app.workspace.getLeavesOfType('vault-exporter-sidebar')[0];
	record('the workspace can open the sidebar view', !openError, openError ? String(openError.message ?? openError) : '');
	const view = leaf?.view;
	record('view created on the right leaf', Boolean(view) && leaf.side === 'right');
	record('header rendered', view?.containerEl.textContent.includes('Vault Exporter') === true);
	record('scope preview counts notes', /notes/.test(view?.containerEl.querySelector('.ve-card__value')?.textContent ?? ''), view?.containerEl.querySelector('.ve-card__value')?.textContent);
	record('all six export targets rendered', view?.containerEl.querySelectorAll('.ve-target').length === 6, view?.containerEl.querySelectorAll('.ve-target').length);
	record('run button rendered', view?.containerEl.querySelector('.ve-sidebar__run')?.textContent === 'Run export');
	record('default target scope is clearly summarized', view?.containerEl.querySelector('.ve-sidebar__selection-summary')?.textContent.includes('All 4 non-ZIP targets selected') === true);
	const selectionStatus = view?.containerEl.querySelector('.ve-sidebar__selection-summary');
	record('target selection summary is announced accessibly', selectionStatus?.getAttribute('role') === 'status' && selectionStatus.getAttribute('aria-live') === 'polite');
	const settingsBtn = view.containerEl.querySelector('.ve-sidebar__settings');
	settingsBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	await sleep(80);
	record('sidebar settings button opens the app settings modal', plugin.app.setting.isOpen === true);
	record('sidebar settings button lands on the plugin settings tab', plugin.app.setting.lastTabId === 'vault-exporter', String(plugin.app.setting.lastTabId));

	const htmlTarget = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'Export as HTML document');
	if (htmlTarget) {
		htmlTarget.click();
		await sleep(40);
		record('sidebar target selection is persisted', JSON.stringify(plugin._data?.settings?.lastSelectedTargets) === '["html"]', JSON.stringify(plugin._data?.settings?.lastSelectedTargets));
		record('sidebar explains the selected target count', view.containerEl.querySelector('.ve-sidebar__selection-summary')?.textContent === '1 target selected: HTML.');
		record('target controls update in place', [...view.containerEl.querySelectorAll('.ve-target')].includes(htmlTarget));
		const markdownTarget = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'Export as consolidated Markdown');
		markdownTarget?.click();
		record('sidebar reports multiple selected formats', view.containerEl.querySelector('.ve-sidebar__selection-summary')?.textContent === '2 targets selected: HTML, Markdown.');
		markdownTarget?.click();
		await sleep(40);
		await view.onClose();
		await view.onOpen();
		const restoredHtml = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'Export as HTML document');
		record('sidebar restores the last selected target', restoredHtml?.getAttribute('aria-pressed') === 'true');
		const allTarget = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'All (consolidated + split)');
		allTarget?.click();
		await sleep(40);
		record('sidebar selection returns to all exports', JSON.stringify(plugin._data?.settings?.lastSelectedTargets) === '["all"]', JSON.stringify(plugin._data?.settings?.lastSelectedTargets));
	} else {
		record('HTML sidebar target is available for persistence test', false);
	}
	await plugin.activateSidebarView();
	record('re-opening reuses the existing leaf', plugin.app.workspace.getLeavesOfType('vault-exporter-sidebar').length === 1);

	console.log('\n--- run all exports (sidebar button) ---');
	consoleErrors.length = 0;
	view.containerEl.querySelector('.ve-sidebar__run').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	await sleep(20);
	record('progress panel opens', window.document.querySelector('.ve-panel') !== null);
	const progressStatus = window.document.querySelector('.ve-panel__status');
	record('progress status is announced accessibly', progressStatus?.getAttribute('role') === 'status' && progressStatus.getAttribute('aria-live') === 'polite');
	record('export completes', (await waitFinished()) === 'Done');
	record('progress panel shows elapsed time', /^Elapsed (?:<1s|\d+(?:s|m|h))/.test(window.document.querySelector('.ve-panel__elapsed')?.textContent ?? ''));
	record('completion summary includes elapsed duration', /in (?:<1s|\d+(?:h \d+m|m \d+s|s))/.test(window.document.querySelector('.ve-panel__current')?.textContent ?? ''));
	record('consolidated outputs written', ['Vault export.md', 'Vault export.html', 'Vault export - NotebookLM.txt'].every(has), ['Vault export.md', 'Vault export.html', 'Vault export - NotebookLM.txt'].filter(has).join(', '));
	record('split folder written', has('Vault export - split'), fs.existsSync(path.join(VAULT, 'Vault export - split')) ? fs.readdirSync(path.join(VAULT, 'Vault export - split')).join(', ') : '');
	record('no console errors during export', consoleErrors.length === 0, consoleErrors.join(' | '));

	if (has('Vault export.md')) {
		const md = out('Vault export.md');
		record('markdown: table of contents present', md.includes('## Table of Contents'));
		record('markdown: both project notes present', md.includes('# Alpha') && md.includes('# Beta'));
		record('markdown: frontmatter stripped', !md.includes('cssclasses') && !md.includes('status: done'));
		record('markdown: wikilink resolved', md.includes('Beta') && !md.includes('[[Beta]]'));
		record('markdown: prose comment removed but inline code kept', !md.includes('%%internal comment%%') && md.includes('code with %% kept'));
		record('markdown: fenced code intact', md.includes('print("hi") # not a heading'));
		record('markdown: dataview table rendered', md.includes('| status |') && /\| Alpha \| done \|/.test(md) && /\| Beta \| done \|/.test(md));
		record('markdown: note embed kept as text', md.includes('Embedded note: Beta') && !md.includes('![[Beta]]'));
		record('markdown: attachment embed kept as its file name', md.includes('Embedded image: pic.png'));
		record('markdown: dataviewjs left as a code block', md.includes('dataviewjs'));
		record('markdown: hidden folder excluded', !md.includes('Secret'));
	}
	if (has('Vault export.html')) {
		const html = out('Vault export.html');
		record('html: standalone document', html.startsWith('<!DOCTYPE html>') && html.includes('</html>'));
		record('html: styles inlined', html.includes('<style'));
		record('html: no undefined leaks', !html.includes('undefined'));
		record('html: code escaped', html.includes('# not a heading'));
	}
	if (has('Vault export - NotebookLM.txt')) {
		const txt = out('Vault export - NotebookLM.txt');
		record('notebooklm: banner + document separators', txt.includes('VAULT EXPORT') && /DOCUMENT \[1\/\d+\]:/.test(txt));
	}

	await sleep(40);
	record('recent exports include elapsed duration', / · (?:<1s|\d+h \d+m|\d+m \d+s|\d+s) · \d+ files · /.test(view.containerEl.querySelector('.ve-history__meta')?.textContent ?? ''));
	const historyReveal = view.containerEl.querySelector('.ve-history__reveal');
	const historyState = require('./obsidian-mock.cjs').__state;
	historyState.revealCalls.length = 0;
	if (historyReveal) {
		historyReveal.click();
		await sleep(30);
		record('history can reveal the first output', historyState.revealCalls.length === 1 && path.isAbsolute(historyState.revealCalls[0]), historyState.revealCalls.join(', '));
	} else {
		record('history output reveal button rendered', false, 'no .ve-history__reveal');
	}
	const clearHistory = view.containerEl.querySelector('.ve-history__clear');
	if (clearHistory) {
		clearHistory.click();
		await sleep(30);
		record('clearing history keeps exported files', plugin.history.length === 0 && has('Vault export.md'), `history=${plugin.history.length}`);
	} else {
		record('history clear action rendered', false, 'no .ve-history__clear');
	}

	console.log('\n--- settings tab ---');
	const tab = plugin._settingTabs[0];
	consoleErrors.length = 0;
	tab.containerEl.empty();
	tab.display();
	record('settings items rendered', tab.containerEl.querySelectorAll('.setting-item').length >= 25, tab.containerEl.querySelectorAll('.setting-item').length);
	record('list rows rendered', tab.containerEl.querySelectorAll('.ve-list-item').length >= 3, tab.containerEl.querySelectorAll('.ve-list-item').length);
	const itemByName = (label) => [...tab.containerEl.querySelectorAll('.setting-item')]
		.find((el) => el.querySelector('.setting-item-name')?.textContent === label);
	record('external output folder controls rendered', Boolean(itemByName('Export to an External Folder')?.querySelector('input[type="checkbox"]')) && Boolean(itemByName('External Folder')?.querySelector('input[type="text"]')));
	record('external folder row offers the native picker', Boolean(itemByName('External Folder')?.querySelector('button')),
		[...(itemByName('External Folder')?.querySelectorAll('button') ?? [])].map((b) => b.textContent || b.getAttribute('data-icon')).join(', '));
	const searchInput = tab.containerEl.querySelector('.ve-settings__search input');
	if (searchInput) {
		searchInput.value = 'focused controls';
		searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
		const visibleRows = [...tab.containerEl.querySelectorAll('.ve-settings-row')].filter((row) => !row.hidden);
		record('settings search filters matching controls and sections', visibleRows.length === 1 && visibleRows[0].textContent.includes('HTML Accent Color') && [...tab.containerEl.querySelectorAll('.ve-settings-section')].filter((section) => !section.hidden).length === 1, visibleRows.map((row) => row.textContent.trim().slice(0, 40)).join(', '));
		searchInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		searchInput.value = 'external';
		searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
		record('settings search finds the external output controls',
			[...tab.containerEl.querySelectorAll('.ve-settings-row')].filter((row) => !row.hidden).length >= 2
				&& [...tab.containerEl.querySelectorAll('.ve-settings-section')].filter((section) => !section.hidden).length === 1);
		searchInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		record('Escape clears settings search', searchInput.value === '' && [...tab.containerEl.querySelectorAll('.ve-settings-section')].every((section) => !section.hidden));
	} else {
		record('settings search control rendered', false, 'no .ve-settings__search input');
	}
	const pill = tab.containerEl.querySelector('.ve-tag-pill');
	if (pill) {
		pill.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await sleep(30);
		record('quick-add pill persists a property', (plugin._data?.settings?.ignoredProperties ?? []).includes(pill.textContent.replace('+ ', '').trim()), JSON.stringify(plugin._data?.settings?.ignoredProperties));
	} else {
		record('quick-add pill rendered', false, 'no .ve-tag-pill');
	}
	const settingByLabel = (label) => [...tab.containerEl.querySelectorAll('.setting-item')]
		.find((el) => el.querySelector('.setting-item-name')?.textContent === label);
	const htmlPreview = tab.containerEl.querySelector('.ve-html-preview');
	record('HTML appearance preview is rendered', htmlPreview?.dataset.theme === 'system' && htmlPreview.style.getPropertyValue('--ve-preview-accent') === '#8b72d9');
	const rememberTargets = settingByLabel('Remember Sidebar Targets')?.querySelector('input[type="checkbox"]');
	if (rememberTargets) {
		rememberTargets.checked = false;
		rememberTargets.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('remember-targets preference can be disabled', plugin._data?.settings?.rememberTargetSelection === false);
		const htmlTargetWhileDisabled = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'Export as HTML document');
		htmlTargetWhileDisabled?.click();
		await view.onClose();
		await view.onOpen();
		const allTargetAfterReopen = [...view.containerEl.querySelectorAll('.ve-target')].find((row) => row.querySelector('.ve-target__label')?.textContent === 'All (consolidated + split)');
		record('disabled target memory starts a reopened sidebar with all', allTargetAfterReopen?.getAttribute('aria-pressed') === 'true' && JSON.stringify(plugin._data?.settings?.lastSelectedTargets) === '["all"]');
		rememberTargets.checked = true;
		rememberTargets.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('remember-targets preference can be restored', plugin._data?.settings?.rememberTargetSelection === true);
	} else {
		record('remember-targets toggle rendered', false, 'no checkbox control');
	}
	const autoRevealPreference = settingByLabel('Reveal Output After Success')?.querySelector('input[type="checkbox"]');
	if (autoRevealPreference) {
		autoRevealPreference.checked = true;
		autoRevealPreference.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('automatic output reveal preference is saved', plugin._data?.settings?.autoRevealOutput === true);
	} else {
		record('automatic output reveal preference rendered', false, 'no checkbox control');
	}
	const completedPanelSelect = settingByLabel('Progress Panel Auto-Close')?.querySelector('select');
	if (completedPanelSelect) {
		completedPanelSelect.value = '0';
		completedPanelSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('completed panel can be kept open', plugin._data?.settings?.progressPanelAutoCloseSeconds === 0);
	} else {
		record('completed panel duration preference rendered', false, 'no select control');
	}
	const outputsInput = settingByLabel('NotebookLM Consolidated Output')?.querySelector('input');
	if (outputsInput) {
		outputsInput.value = 'Out/notebooklm.txt';
		outputsInput.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('edited text setting is saved', plugin._data?.settings?.notebooklmOutputPath === 'Out/notebooklm.txt', plugin._data?.settings?.notebooklmOutputPath);
	}
	const themeSelect = settingByLabel('HTML Color Theme')?.querySelector('select');
	if (themeSelect) {
		themeSelect.value = 'dark';
		themeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('HTML theme preference is saved', plugin._data?.settings?.htmlTheme === 'dark', plugin._data?.settings?.htmlTheme);
		record('HTML appearance preview follows theme changes', htmlPreview?.dataset.theme === 'dark', htmlPreview?.dataset.theme);
		themeSelect.value = 'system';
		themeSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
	}
	const accentPicker = settingByLabel('HTML Accent Color')?.querySelector('input[type="color"]');
	if (accentPicker) {
		accentPicker.value = '#c0392b';
		accentPicker.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('HTML accent color preference is saved', plugin._data?.settings?.htmlAccentColor === '#c0392b', plugin._data?.settings?.htmlAccentColor);
		record('HTML appearance preview follows accent changes', htmlPreview?.style.getPropertyValue('--ve-preview-accent') === '#c0392b');
		accentPicker.value = '#8b72d9';
		accentPicker.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
	}
	const widthSlider = settingByLabel('HTML Reading Width')?.querySelector('input[type="range"]');
	if (widthSlider) {
		widthSlider.value = '1040';
		widthSlider.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
		record('HTML reading width preference is saved', plugin._data?.settings?.htmlContentWidth === 1040, plugin._data?.settings?.htmlContentWidth);
		record('HTML appearance preview follows width changes', htmlPreview?.style.maxWidth === '1040px', htmlPreview?.style.maxWidth);
		widthSlider.value = '920';
		widthSlider.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
	}
	record('no console errors in settings', consoleErrors.length === 0, consoleErrors.join(' | '));

	console.log('\n--- command palette targets ---');
	plugin.settings = { ...plugin.settings, notebooklmOutputPath: 'Vault export - NotebookLM.txt' };
	const runCommand = async (id) => {
		const cmd = plugin._commands.find((c) => c.id === id);
		await cmd.callback();
		return waitFinished();
	};
	const autoRevealState = require('./obsidian-mock.cjs').__state;
	autoRevealState.revealCalls.length = 0;
	record('export-markdown finishes', (await runCommand('export-markdown')) === 'Done');
	record('successful export automatically reveals its first output', autoRevealState.revealCalls.length === 1 && path.isAbsolute(autoRevealState.revealCalls[0]), autoRevealState.revealCalls.join(', '));
	record('keep-open preference leaves the completed panel visible', window.document.querySelector('.ve-panel') !== null);
	if (completedPanelSelect) {
		completedPanelSelect.value = '8';
		completedPanelSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
	}
	record('progress panel auto-close delay can be restored', plugin.settings.progressPanelAutoCloseSeconds === 8);
	if (autoRevealPreference) {
		autoRevealPreference.checked = false;
		autoRevealPreference.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(30);
	}
	record('automatic reveal can be switched off', plugin.settings.autoRevealOutput === false);
	record('export-zip finishes', (await runCommand('export-zip')) === 'Done');
	if (has('Vault export.zip')) {
		const zip = fs.readFileSync(path.join(VAULT, 'Vault export.zip'));
		record('zip has a PK signature', zip.subarray(0, 4).toString('latin1') === 'PK\x03\x04', zip.subarray(0, 4).toString('latin1'));
		record('zip stores entry names', zip.includes(Buffer.from('Vault export.md')) && zip.includes(Buffer.from('Vault export - split/')));
	}

	console.log('\n--- active note / folder commands ---');
	const { setActiveFile } = require('./app-mock.cjs');
	setActiveFile(plugin.app, 'Projects/Alpha.md');
	record('export-active-note finishes', (await runCommand('export-active-note')) === 'Done');
	record('clean export written next to the note', has('Projects/Alpha (clean export).md'));
	record('export-active-folder finishes', (await runCommand('export-active-folder')) === 'Done');

	console.log('\n--- cancellation ---');
	void runCommand('export-all');
	await sleep(15);
	const cancelBtn = window.document.querySelector('.ve-panel__cancel');
	cancelBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	record('cancel click handled', Boolean(cancelBtn));
	record('panel reports cancellation or completion', ['Cancelled', 'Done'].includes(await waitFinished()), panelStatus());
	record('no stuck running state', plugin._commands.length === 10 && window.document.querySelector('.ve-panel__cancel')?.isShown() === false, window.document.querySelector('.ve-panel__status')?.textContent);

	console.log('\n--- reveal shortcut ---');
	// Fresh, deterministic run: the reveal button appears after a successful export.
	record('export-markdown finishes again', (await runCommand('export-markdown')) === 'Done');
	const revealState = require('./obsidian-mock.cjs').__state;
	revealState.revealCalls.length = 0;
	const revealBtn = window.document.querySelector('.ve-panel__reveal');
	if (revealBtn) {
		revealBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await sleep(30);
		record('electron shell receives the OS path', revealState.revealCalls.length === 1 && path.isAbsolute(revealState.revealCalls[0]), revealState.revealCalls.join(', '));
	} else {
		record('reveal button offered after an export', false, `no .ve-panel__reveal (panel: ${panelText().slice(0, 120)})`);
	}

	console.log('\n--- external output folder ---');
	const EXTERNAL = path.join(os.tmpdir(), 'vault-exporter-smoke-external');
	fs.rmSync(EXTERNAL, { recursive: true, force: true });
	const mockState = require('./obsidian-mock.cjs').__state;
	// Enabling the toggle with no folder opens the native picker.
	mockState.pickedFolder = EXTERNAL;
	plugin.settings.useExternalOutputFolder = false;
	plugin.settings.externalOutputFolder = '';
	await plugin.saveSettings();
	tab.display();
	const externalToggle = itemByName('Export to an External Folder')?.querySelector('input[type="checkbox"]');
	if (externalToggle) {
		externalToggle.checked = true;
		externalToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
		await sleep(120);
	}
	record('enabling external output opens the picker and stores the folder',
		plugin._data?.settings?.useExternalOutputFolder === true && plugin._data?.settings?.externalOutputFolder === EXTERNAL,
		String(plugin._data?.settings?.externalOutputFolder));
	record('external folder description shows the destination', (itemByName('External Folder')?.textContent ?? '').includes(EXTERNAL));

	const vaultBefore = fs.readdirSync(VAULT).sort();
	record('export-markdown (external) finishes', (await runCommand('export-markdown')) === 'Done');
	record('external output written outside the vault', fs.existsSync(path.join(EXTERNAL, 'Vault export.md')));
	record('export history records the external path', String(plugin.history[0]?.files?.[0]?.path ?? '').startsWith(EXTERNAL), String(plugin.history[0]?.files?.[0]?.path));
	record('the vault gained no new output file',
		JSON.stringify(fs.readdirSync(VAULT).sort()) === JSON.stringify(vaultBefore),
		fs.readdirSync(VAULT).filter((name) => !vaultBefore.includes(name)).join(', '));
	await view.refresh();
	record('sidebar announces the external destination', /outside the vault/.test(view.containerEl.textContent ?? ''));

	plugin.settings.useExternalOutputFolder = false;
	plugin.settings.externalOutputFolder = '';
	await plugin.saveSettings();
	fs.rmSync(EXTERNAL, { recursive: true, force: true });
	tab.display();

	console.log('\n--- graceful degradation without Electron ---');
	plugin.gateway.revealOutput = () => null;
	record('reveal returns false when no OS path', plugin.gateway.revealInFileManager('Vault export.md') === false);
	delete plugin.gateway.revealOutput;

	console.error = realError;
	console.warn = realWarn;
	console.log('\n--- console hygiene ---');
	record('warnings are informational only', consoleWarnings.every((w) => w.startsWith('[vault-exporter]')), consoleWarnings.slice(0, 3).join(' | '));
	record('no unexpected console errors in the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

	if (!KEEP) fs.rmSync(VAULT, { recursive: true, force: true });
})().then(() => {
	const failed = results.filter((r) => !r.ok);
	console.log('\n================ SMOKE SUMMARY ================');
	console.log(`${results.length - failed.length} passed, ${failed.length} failed`);
	for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? ' -> ' + f.detail : ''}`);
	process.exit(failed.length > 0 ? 1 : 0);
}).catch((error) => {
	stderrWrite('SMOKE CRASH ' + (error && error.stack ? error.stack : String(error)));
	process.exit(2);
});
