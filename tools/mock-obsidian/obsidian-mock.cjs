/**
 * Faithful-enough runtime mock of the `obsidian` module, mirroring the
 * signatures in obsidian.d.ts (minAppVersion target: 1.7.2) so the real
 * bundle can be exercised outside Obsidian.
 *
 * Deliberately absent unless enabled: a `Shell` export (Obsidian has none).
 */
'use strict';

const { applyDomElementInfo } = require('./dom-helpers.cjs');

const state = {
	notices: [],
	shellEnabled: false,
	revealCalls: [],
	openPathCalls: [],
	pickedFolder: null,
	folderPickerCanceled: false,
	ribbonIcons: [],
	iconCalls: [],
};

class Events {
	constructor() { this._events = new Map(); }
	on(name, cb) { if (!this._events.has(name)) this._events.set(name, new Set()); this._events.get(name).add(cb); return { unsubscribe: () => this.off(name, cb) }; }
	off(name, cb) { this._events.get(name)?.delete(cb); }
	trigger(name, ...args) { for (const cb of this._events.get(name) ?? []) cb(...args); }
}

class Component {
	constructor() { this._loaded = false; this._children = []; }
	load() { this.onload(); this._loaded = true; }
	onload() {}
	unload() { this.onunload(); }
	onunload() {}
	addChild(c) { this._children.push(c); return c; }
	register(cb) { return cb; }
	registerEvent(ref) { return ref; }
	registerDomEvent(el, type, cb) { el.addEventListener(type, cb); return { el, type, cb }; }
	registerInterval(id) { return id; }
}

class Notice {
	constructor(message, duration) {
		this.message = message;
		this.duration = duration ?? 5000;
		this.noticeEl = document.body.createDiv({ cls: 'notice' });
		this.noticeEl.createDiv({ cls: 'notice-message', text: String(message) });
		this.hidden = false;
		state.notices.push(this);
	}
	setMessage(message) { this.message = message; this.noticeEl.setText(String(message)); return this; }
	hide() { this.hidden = true; this.noticeEl.detach(); }
}

class Plugin extends Component {
	constructor(app, manifest) {
		super();
		this.app = app;
		this.manifest = manifest;
		this._commands = [];
		this._settingTabs = [];
		this._views = new Map();
		this._ribbonIcons = [];
		this._data = {};
	}
	async loadData() { return this._data; }
	async saveData(data) { this._data = data; }
	addSettingTab(tab) { this._settingTabs.push(tab); this.app.setting?.tabs?.push(tab); }
	registerView(type, factory) { this._views.set(type, factory); }
	addRibbonIcon(icon, title, callback) { const el = document.body.createDiv({ cls: 'side-dock-ribbon-action' }); el.addEventListener('click', callback); this._ribbonIcons.push({ icon, title, el }); return el; }
	addCommand(cmd) { this._commands.push(cmd); return cmd; }
	addStatusBarItem() { return document.body.createDiv(); }
	async onload() {}
	onunload() {}
}

class ItemView extends Component {
	constructor(leaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = document.createElement('div');
		this.containerEl.addClass('workspace-leaf-content');
		const header = this.containerEl.createDiv({ cls: 'view-header' });
		header.createDiv({ cls: 'view-header-title' });
		this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
		leaf.containerEl?.appendChild(this.containerEl);
	}
	getViewType() { return 'unknown'; }
	getDisplayText() { return ''; }
	getIcon() { return 'document'; }
	/**
	 * Internal Obsidian lifecycle method (not in the public typings). The
	 * workspace calls `view.open()` when a leaf's view state is applied; a
	 * subclass field named `open` shadows it and breaks "Failed to open view".
	 */
	async open(state) { this.state = state; return this.onOpen(); }
	async onOpen() {}
	async onClose() {}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
		this.containerEl.addClass('vertical-tab-content');
		this.tabEl = document.createElement('div');
		this.containerEl.appendChild(this.tabEl);
	}
	display() {}
	hide() {}
	open() {}
}

class Setting {
	constructor(containerEl) {
		this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
		this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
		this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	}
	setName(name) { this.nameEl.setText(name); return this; }
	setDesc(desc) { this.descEl.setText(desc); return this; }
	setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
	setClass(cls) { this.settingEl.addClass(cls); return this; }
	setTooltip(tooltip) { this.settingEl.setAttribute('aria-label', tooltip); return this; }
	setDisabled(disabled) { this.settingEl.toggleClass('is-disabled', disabled); this.controlEl.findAll('input,button,select,textarea').forEach((el) => { el.disabled = disabled; }); return this; }
	addButton(cb) { const c = new ButtonComponent(this.controlEl); cb(c); return this; }
	addExtraButton(cb) { const c = new ExtraButtonComponent(this.controlEl); cb(c); return this; }
	addToggle(cb) { const c = new ToggleComponent(this.controlEl); cb(c); return this; }
	addText(cb) { const c = new TextComponent(this.controlEl); cb(c); return this; }
	addSearch(cb) { const c = new SearchComponent(this.controlEl); cb(c); return this; }
	addTextArea(cb) { const c = new TextAreaComponent(this.controlEl); cb(c); return this; }
	addDropdown(cb) { const c = new DropdownComponent(this.controlEl); cb(c); return this; }
	addSlider(cb) { const c = new SliderComponent(this.controlEl); cb(c); return this; }
	addColorPicker(cb) { const c = new ColorComponent(this.controlEl); cb(c); return this; }
	addProgressBar(cb) { const c = new ProgressBarComponent(this.controlEl); cb(c); return this; }
	addMomentFormat(cb) { const c = new TextComponent(this.controlEl); cb(c); return this; }
	then(cb) { cb(this); return this; }
}

class ValueComponent {
	constructor(containerEl, tag = 'input') { this.containerEl = containerEl; this.inputEl = containerEl.createEl(tag); this.disabled = false; this.changeCb = null; }
	setValue(value) { this.inputEl.value = value; this.changeCb?.(value); return this; }
	getValue() { return this.inputEl.value; }
	onChange(cb) { this.changeCb = cb; this.inputEl.addEventListener('change', () => cb(this.getValue())); return this; }
	setDisabled(disabled) { this.disabled = disabled; this.inputEl.disabled = disabled; return this; }
	registerOptionListener() { return this; }
	setPlaceholder(placeholder) { this.inputEl.setAttribute('placeholder', placeholder); return this; }
}
class TextComponent extends ValueComponent { constructor(c) { super(c, 'input'); this.inputEl.type = 'text'; } }
class SearchComponent extends ValueComponent { constructor(c) { super(c, 'input'); this.inputEl.type = 'search'; this.inputEl.addClass('search-input'); this.clearButtonEl = c.createDiv({ cls: 'search-input-clear-button' }); } }
class TextAreaComponent extends ValueComponent { constructor(c) { super(c, 'textarea'); } }
class ToggleComponent extends ValueComponent {
	constructor(c) { super(c, 'input'); this.inputEl.type = 'checkbox'; }
	getValue() { return this.inputEl.checked; }
	setValue(value) { this.inputEl.checked = Boolean(value); this.changeCb?.(this.getValue()); return this; }
	onChange(cb) { this.changeCb = cb; this.inputEl.addEventListener('change', () => cb(this.getValue())); return this; }
}
class DropdownComponent extends ValueComponent {
	constructor(c) { super(c, 'select'); this.selectEl = this.inputEl; }
	addOption(value, display) { const opt = this.selectEl.createEl('option', { value }); opt.textContent = display; return this; }
	addOptions(options) { for (const [value, display] of Object.entries(options)) this.addOption(value, display); return this; }
	setValue(value) { this.selectEl.value = value; this.changeCb?.(this.getValue()); return this; }
	getValue() { return this.selectEl.value; }
	onChange(cb) { this.changeCb = cb; this.selectEl.addEventListener('change', () => cb(this.getValue())); return this; }
}
class SliderComponent extends ValueComponent {
	constructor(c) {
		super(c, 'input');
		this.inputEl.type = 'range';
		this.sliderEl = this.inputEl;
		this.valueEl = c.createDiv({ cls: 'slider-value' });
		this.inputEl.addEventListener('input', () => this.valueEl.setText(String(this.getValue())));
	}
	setLimits(min, max, step) { this.inputEl.setAttribute('min', min); this.inputEl.setAttribute('max', max); this.inputEl.setAttribute('step', step); return this; }
	getValue() { return Number(this.inputEl.value); }
	setValue(value) { this.inputEl.value = String(value); this.changeCb?.(this.getValue()); return this; }
	setDynamicTooltip() { return this; }
	setInstant() { return this; }
	showTooltip() { return this; }
}
class ColorComponent extends ValueComponent { constructor(c) { super(c, 'input'); this.inputEl.type = 'color'; } }
class ProgressBarComponent extends ValueComponent { constructor(c) { super(c, 'progress'); } getValue() { return this.inputEl.value; } }
class ButtonComponent {
	constructor(containerEl) { this.containerEl = containerEl; this.buttonEl = containerEl.createEl('button', { type: 'button' }); }
	setButtonText(text) { this.buttonEl.setText(text); return this; }
	setIcon(icon) { this.buttonEl.setAttribute('data-icon', icon); return this; }
	setTooltip(tooltip) { this.buttonEl.setAttribute('aria-label', tooltip); return this; }
	setCta() { this.buttonEl.addClass('mod-cta'); return this; }
	setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
	setDisabled(disabled) { this.buttonEl.disabled = disabled; return this; }
	removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
	onClick(cb) { this.buttonEl.addEventListener('click', cb); return this; }
}
class ExtraButtonComponent extends ButtonComponent {
	constructor(c) { super(c); this.extraSettingsEl = this.buttonEl; }
	setIcon(icon) { this.buttonEl.setAttribute('data-icon', icon); applyIcon(this.buttonEl, icon); return this; }
}
class PopoverSuggest {
	constructor(app, textInputEl) { this.app = app; this.textInputEl = textInputEl; this.limit = 100; this.suggestions = []; this.selectedIndex = -1; }
	open() { this.isOpen = true; }
	close() { this.isOpen = false; }
	renderSuggestion() {}
	selectSuggestion() {}
	onSelect(cb) { this._onSelect = cb; return this; }
}
class AbstractInputSuggest extends PopoverSuggest {
	constructor(app, textInputEl) {
		super(app, textInputEl);
		this.scope = { register: () => {} };
		this.containerEl = document.body.createDiv({ cls: 'suggestion-container' });
		this.containerEl.hide();
		this.listEl = this.containerEl.createDiv({ cls: 'suggestion-list' });
		const refresh = async () => {
			const results = await this.getSuggestions(this.getValue());
			this.suggestions = results;
			this.listEl.empty();
			for (const item of results) {
				const el = this.listEl.createDiv({ cls: 'suggestion-item' });
				this.renderSuggestion(item, el);
				el.addEventListener('click', () => this.selectSuggestion(item, { type: 'click' }));
			}
			if (results.length > 0) { this.containerEl.show(); this.isOpen = true; } else { this.containerEl.hide(); this.isOpen = false; }
		};
		this.textInputEl.addEventListener('input', () => { void refresh(); });
		this.textInputEl.addEventListener('focus', () => { void refresh(); });
	}
	setValue(value) { this.textInputEl.value = value; }
	getValue() { return this.textInputEl.value; }
	close() { this.isOpen = false; this.containerEl.hide(); }
}

function applyIcon(el, icon) {
	state.iconCalls.push(icon);
	el.setAttribute('data-icon', icon);
	if (!el.querySelector('svg')) el.createSvg('svg', { cls: 'svg-icon' });
}

const TFile = class TFile {
	constructor(path, stat, parent) {
		this.path = path;
		this.name = path.split('/').pop();
		this.basename = this.name.replace(/\.[^.]+$/, '');
		this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
		this.stat = stat;
		this.parent = parent ?? null;
		this.vault = null;
		this.deleted = false;
	}
};

const TFolder = class TFolder {
	constructor(path, parent) {
		this.path = path;
		this.name = path.split('/').pop() ?? '';
		this.parent = parent ?? null;
		this.children = [];
		this.vault = null;
	}
	isRoot() { return this.path === '/'; }
};

class FileSystemAdapter {
	constructor(basePath) { this.basePath = basePath; }
	getBasePath() { return this.basePath; }
	getName() { return this.basePath.split(/[\\/]/).filter(Boolean).pop() ?? ''; }
	async exists(p) { return require('fs').existsSync(require('path').join(this.basePath, p)); }
}

const Platform = { isMobile: false, isDesktop: true, isMobileApp: false, isIosApp: false, isAndroidApp: false, isMacOS: true, isWin: false, isLinux: false, isPhone: false, isTablet: false };
const apiVersion = '1.7.2';

function normalizePath(p) {
	let out = p.replace(/\\/g, '/');
	out = out.replace(/\/{2,}/g, '/');
	out = out.replace(/^\/+|\/+$/g, '');
	return out;
}
function setIcon(el, icon) { applyIcon(el, icon); }
function addIcon() {}
function debounce(cb, timeout = 0, resetTimer = true) {
	let timer = null;
	return function (...args) { if (timer !== null && resetTimer) clearTimeout(timer); if (resetTimer) timer = setTimeout(() => cb.apply(this, args), timeout); else if (timer === null) { timer = setTimeout(() => { timer = null; cb.apply(this, args); }, timeout); } };
}
function moment() { throw new Error('moment is not used by the plugin'); }
function requireApiVersion(version) { return version <= apiVersion; }
class MarkdownRenderer {
	static render(app, markdown, el, sourcePath, component) { el.setText(markdown); return Promise.resolve(); }
}
class Modal {
	constructor(app) { this.app = app; this.containerEl = document.body.createDiv({ cls: 'modal-container' }); this.contentEl = this.containerEl.createDiv({ cls: 'modal-content' }); }
	open() { this.isOpen = true; } close() { this.isOpen = false; this.containerEl.detach(); }
	onOpen() {} onClose() {}
}
class SuggestModal extends Modal {}
class FuzzySuggestModal extends SuggestModal {}
class FileSystemAdapterClass {}
class Vault {}
class MetadataCache {}
class Workspace {}
class WorkspaceLeaf {
	constructor(app, containerEl) {
		this.app = app;
		this.containerEl = containerEl ?? document.body.createDiv({ cls: 'workspace-leaf' });
		this.view = null;
		this.parent = null;
		this.active = false;
	}
	async setViewState(viewState, eState) {
		this.viewState = viewState;
		if (viewState.type !== (this.view?.getViewType?.() ?? null)) {
			const factory = this.app.pluginViews?.get(viewState.type);
			if (!factory) throw new Error('No view registered for type: ' + viewState.type);
			this.view = factory(this);
		}
		// Obsidian's own open path: it calls view.open(state) and lets a
		// missing method surface as "Failed to open view".
		if (typeof this.view?.open !== 'function') {
			throw new TypeError('e.open is not a function');
		}
		await this.view.open(viewState);
		return this;
	}
	getViewState() { return this.viewState; }
	async openFile() {}
	detach() { this.containerEl.detach(); }
}
class View extends ItemView {}
const keymap = {};

const api = {
	Events, Component, Notice, Plugin, PluginSettingTab, Setting, ItemView, View, WorkspaceLeaf, Vault, MetadataCache, Workspace,
	Platform, TFile, TFolder, FileSystemAdapter, FileSystemAdapterClass, Modal, SuggestModal, FuzzySuggestModal,
	normalizePath, setIcon, addIcon, debounce, moment, requireApiVersion, MarkdownRenderer, apiVersion, keymap,
	AbstractInputSuggest, PopoverSuggest,
	ValueComponent, TextComponent, TextAreaComponent, SearchComponent, ToggleComponent, DropdownComponent, SliderComponent, ColorComponent, ProgressBarComponent, ButtonComponent, ExtraButtonComponent,
	__state: state,
};
if (state.shellEnabled) {
	api.Shell = {
		openExternal: async () => {},
		openPath: async () => '',
		showItemInFolder: (p) => state.revealCalls.push(p),
		revealInFileExplorer: (p) => state.revealCalls.push(p),
		trashItem: async () => {},
	};
}

module.exports = api;
module.exports.__setShellEnabled = (enabled) => { state.shellEnabled = enabled; if (enabled && !api.Shell) api.Shell = { showItemInFolder: (p) => state.revealCalls.push(p) }; };
module.exports.__domset = { applyDomElementInfo };
