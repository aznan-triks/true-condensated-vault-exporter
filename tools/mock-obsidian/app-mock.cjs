/**
 * Filesystem-backed mock of Obsidian's App (vault, metadata cache, workspace),
 * modelled on obsidian.d.ts. Every method the plugin calls mirrors the real
 * signature and async-ness.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const obsidian = require('./obsidian-mock.cjs');
const { TFile, TFolder, FileSystemAdapter, WorkspaceLeaf, Events } = obsidian;

function parseFrontmatter(text) {
	if (!text.startsWith('---')) return { frontmatter: null, tags: [] };
	const end = text.indexOf('\n---', 3);
	if (end === -1) return { frontmatter: null, tags: [] };
	const block = text.slice(text.indexOf('\n', 3) + 1, end);
	const frontmatter = {};
	for (const line of block.split('\n')) {
		const m = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line);
		if (!m) continue;
		let value = m[2].trim();
		if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
		else value = value.replace(/^["']|["']$/g, '');
		frontmatter[m[1].trim()] = value;
	}
	return { frontmatter, tags: [] };
}

function bodyTags(text) {
	const tags = new Map();
	const re = /(^|\s)#([A-Za-z0-9_\-/]+)/g;
	let m;
	while ((m = re.exec(text)) !== null) tags.set(m[2], { tag: '#' + m[2], position: {} });
	return [...tags.values()];
}

function makeVault(root) {
	const vault = new Events();
	vault.adapter = new FileSystemAdapter(root);
	vault._files = new Map();
	vault._folders = new Map();

	const folderFor = (rel) => {
		if (rel === '' ) return vault._folders.get('');
		return vault._folders.get(rel);
	};
	const ensureFolder = (rel) => {
		if (vault._folders.has(rel)) return vault._folders.get(rel);
		if (rel === '') {
			const root = new TFolder('', null);
			root.vault = vault;
			vault._folders.set('', root);
			return root;
		}
		const parts = rel.split('/');
		const parentRel = parts.slice(0, -1).join('/');
		const parent = ensureFolder(parentRel);
		const folder = new TFolder(rel, parent);
		folder.vault = vault;
		parent.children.push(folder);
		vault._folders.set(rel, folder);
		return folder;
	};

	vault.rescan = () => {
		for (const f of vault._files.values()) { f.deleted = true; }
		vault._files.clear();
		for (const f of vault._folders.values()) f.children = [];
		vault._folders.clear();
		ensureFolder('');
		const walk = (dir, rel) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				const childRel = rel ? rel + '/' + entry.name : entry.name;
				if (entry.isDirectory()) { ensureFolder(childRel); walk(full, childRel); }
				else {
					const stat = fs.statSync(full);
					const file = new TFile(childRel, { ctime: stat.birthtimeMs, mtime: stat.mtimeMs, size: stat.size }, folderFor(rel));
					file.vault = vault;
					vault._files.set(childRel, file);
					file.parent?.children.push(file);
				}
			}
		};
		walk(root, '');
	};

	vault.getName = () => path.basename(root);
	vault.getFiles = () => [...vault._files.values()];
	vault.getMarkdownFiles = () => [...vault._files.values()].filter((f) => f.extension === 'md');
	vault.getAllLoadedFiles = () => [...vault._folders.values(), ...vault._files.values()];
	vault.getRoot = () => vault._folders.get('');
	vault.getAllFolders = (includeRoot = false) => [...vault._folders.values()].filter((f) => includeRoot || f.path !== '');
	vault.getAbstractFileByPath = (p) => vault._files.get(p) ?? vault._folders.get(p) ?? null;
	vault.getFileByPath = (p) => vault._files.get(p) ?? null;
	vault.getFolderByPath = (p) => vault._folders.get(p) ?? null;
	vault.read = async (file) => fs.readFileSync(path.join(root, file.path), 'utf8');
	vault.cachedRead = (file) => vault.read(file);
	vault.readBinary = async (file) => fs.readFileSync(path.join(root, file.path));
	vault.create = async (p, data) => {
		const full = path.join(root, p);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, data, 'utf8');
		vault.rescan();
		vault.trigger('create', vault._files.get(p));
		return vault._files.get(p);
	};
	vault.modify = async (file, data) => {
		fs.writeFileSync(path.join(root, file.path), data, 'utf8');
		vault.rescan();
		vault.trigger('modify', vault._files.get(file.path));
	};
	vault.createBinary = async (p, data) => {
		const full = path.join(root, p);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, Buffer.from(data));
		vault.rescan();
		return vault._files.get(p);
	};
	vault.modifyBinary = async (file, data) => {
		fs.writeFileSync(path.join(root, file.path), Buffer.from(data));
		vault.rescan();
	};
	vault.createFolder = async (p) => {
		fs.mkdirSync(path.join(root, p), { recursive: true });
		vault.rescan();
		return vault._folders.get(p);
	};
	vault.delete = async (file) => { fs.rmSync(path.join(root, file.path), { recursive: true, force: true }); vault.rescan(); };
	vault.rename = async (file, newPath) => { fs.renameSync(path.join(root, file.path), path.join(root, newPath)); vault.rescan(); };
	vault.trash = vault.delete;

	const metadataCache = new Events();
	metadataCache.getFileCache = (file) => {
		if (!file || file.extension !== 'md') return null;
		let text = '';
		try { text = fs.readFileSync(path.join(root, file.path), 'utf8'); } catch { return null; }
		const { frontmatter, tags } = parseFrontmatter(text);
		const fmTags = frontmatter?.tags;
		const list = [...bodyTags(text)];
		if (Array.isArray(fmTags)) for (const t of fmTags) list.push({ tag: '#' + t });
		else if (typeof fmTags === 'string') for (const t of fmTags.split(/[,\s]+/).filter(Boolean)) list.push({ tag: '#' + t.replace(/^#/, '') });
		return { frontmatter: frontmatter ?? {}, tags: list, headings: [], links: [], embeds: [], sections: [] };
	};
	metadataCache.getBacklinksForFile = () => ({ data: new Map() });

	const workspace = new Events();
	const leaves = [];
	workspace.activeLeaf = null;
	workspace.getLeavesOfType = (type) => leaves.filter((l) => l.view?.getViewType?.() === type);
	workspace.getRightLeaf = (split) => { const leaf = new WorkspaceLeaf(app); leaf.side = 'right'; leaves.push(leaf); app.containerEl.appendChild(leaf.containerEl); return leaf; };
	workspace.getLeftLeaf = (split) => { const leaf = new WorkspaceLeaf(app); leaf.side = 'left'; leaves.push(leaf); app.containerEl.appendChild(leaf.containerEl); return leaf; };
	workspace.getLeaf = (newLeaf) => { const leaf = new WorkspaceLeaf(app); leaves.push(leaf); app.containerEl.appendChild(leaf.containerEl); return leaf; };
	workspace.revealLeaf = (leaf) => { workspace.activeLeaf = leaf; leaf.active = true; app.containerEl.appendChild(leaf.containerEl); };
	workspace.iterateAllLeaves = (cb) => leaves.forEach(cb);
	workspace.getActiveFile = () => workspace._activeFile ?? null;
	workspace.setActiveLeaf = (leaf) => { workspace.activeLeaf = leaf; };
	workspace.onLayoutReady = (cb) => cb();
	workspace.detachLeavesOfType = (type) => { for (const l of workspace.getLeavesOfType(type)) l.containerEl.detach(); };

	vault.rescan();
	const app = { vault, metadataCache, workspace, containerEl: null };
	return { app, vault, metadataCache, workspace, leaves };
}

function setActiveFile(app, relPath) {
	app.workspace._activeFile = app.vault.getAbstractFileByPath(relPath) ?? null;
	return app.workspace._activeFile;
}

module.exports = { makeVault, setActiveFile };
