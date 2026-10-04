/**
 * Reproduces Obsidian's DOM prototype extensions (the helper methods the real
 * app injects into Element/HTMLElement at startup) on top of jsdom.
 */
'use strict';

function applyDomElementInfo(el, info) {
	if (info === undefined || info === null) return;
	if (typeof info === 'string') {
		el.className = info;
		return;
	}
	if (info.cls) {
		for (const c of String(info.cls).split(/\s+/)) if (c) el.classList.add(c);
	}
	if (info.text !== undefined) el.textContent = String(info.text);
	if (info.attr) for (const [k, v] of Object.entries(info.attr)) { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); }
	if (info.title) el.setAttribute('title', info.title);
	if (info.type) el.setAttribute('type', info.type);
	if (info.href) el.setAttribute('href', info.href);
	if (info.value !== undefined) el.value = info.value;
	if (info.placeholder) el.setAttribute('placeholder', info.placeholder);
	if (info.parent) info.parent.appendChild(el);
	else if (info.prepend) info.prepend.prependChild(el);
	if (info.cls === undefined && !el.className && typeof info === 'object' && typeof info.cls === 'string') el.className = info.cls;
	return el;
}

function install(window) {
	const { Element, HTMLElement, Document, DocumentFragment, Node, Text } = window;
	const proto = HTMLElement.prototype;

	proto.empty = function empty() { while (this.firstChild) this.removeChild(this.firstChild); this.textContent = ''; };
	proto.detach = function detach() { this.parentNode?.removeChild(this); };
	proto.createEl = function createEl(tag, info, callback) {
		const el = this.doc.createElement(tag);
		applyDomElementInfo(el, info);
		this.appendChild(el);
		if (typeof callback === 'function') callback(el);
		return el;
	};
	proto.createDiv = function createDiv(info, callback) { return this.createEl('div', info, callback); };
	proto.createSpan = function createSpan(info, callback) { return this.createEl('span', info, callback); };
	proto.createSvg = function createSvg(tag, info, callback) {
		const el = this.doc.createElementNS('http://www.w3.org/2000/svg', tag);
		applyDomElementInfo(el, info);
		this.appendChild(el);
		if (typeof callback === 'function') callback(el);
		return el;
	};
	proto.prependChild = function prependChild(child) { this.insertBefore(child, this.firstChild); return child; };
	proto.appendText = function appendText(text) { this.appendChild(this.doc.createTextNode(String(text))); };
	proto.setText = function setText(text) { this.textContent = text === null || text === undefined ? '' : String(text); };
	proto.getText = function getText() { return this.textContent ?? ''; };
	proto.addClass = function addClass(...classes) {
		for (const c of classes) for (const part of String(c).split(/\s+/)) if (part) this.classList.add(part);
	};
	proto.removeClass = function removeClass(...classes) {
		for (const c of classes) for (const part of String(c).split(/\s+/)) if (part) this.classList.remove(part);
	};
	proto.toggleClass = function toggleClass(classes, value) {
		const list = Array.isArray(classes) ? classes : String(classes).split(/\s+/);
		for (const c of list) if (c) this.classList.toggle(c, value);
	};
	proto.hasClass = function hasClass(cls) { return this.classList.contains(cls); };
	proto.setClass = function setClass(cls) { this.className = cls; };
	proto.getClasses = function getClasses() { return [...this.classList]; };
	proto.setAttr = function setAttr(name, value) { if (value === null || value === false) this.removeAttribute(name); else this.setAttribute(name, String(value)); };
	proto.setAttrs = function setAttrs(obj) { for (const [k, v] of Object.entries(obj)) this.setAttr(k, v); };
	proto.getAttr = function getAttr(name) { return this.getAttribute(name); };
	proto.setCssStyles = function setCssStyles(styles) { for (const [k, v] of Object.entries(styles)) this.style.setProperty(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), String(v)); };
	proto.setCssProps = function setCssProps(props) { for (const [k, v] of Object.entries(props)) this.style.setProperty('--' + k, String(v)); };
	proto.hide = function hide() { this.classList.add('ve-hidden'); this.style.display = 'none'; this.setAttribute('aria-hidden', 'true'); };
	proto.show = function show() { this.classList.remove('ve-hidden'); this.style.display = ''; this.removeAttribute('aria-hidden'); };
	proto.toggle = function toggle(show) { if (show === undefined ? this.hasClass('ve-hidden') : show) this.show(); else this.hide(); };
	proto.isShown = function isShown() { return !this.hasClass('ve-hidden'); };
	proto.insertAfter = function insertAfter(node) { this.parentNode?.insertBefore(node, this.nextSibling); return node; };
	proto.find = function find(sel) { return this.querySelector(sel); };
	proto.findAll = function findAll(sel) { return [...this.querySelectorAll(sel)]; };
	proto.onClickEvent = function onClickEvent(cb) { this.addEventListener('click', cb); };
	proto.on = function on(type, sel, cb) { this.addEventListener(type, (e) => { const t = e.target?.closest?.(sel); if (t && this.contains(t)) cb(e, t); }); };

	Object.defineProperty(Node.prototype, 'doc', { get() { return this.ownerDocument ?? (this.nodeType === 9 ? this : null); } });
	Object.defineProperty(Node.prototype, 'win', { get() { return this.doc?.defaultView ?? null; } });
	Object.defineProperty(Node.prototype, 'instanceOf', { value: function (type) { return this instanceof type; } });
	for (const P of [Element, HTMLElement, Document, DocumentFragment]) {
		if (P === HTMLElement) continue;
		if (P === Element) {
			P.prototype.empty = HTMLElement.prototype.empty;
			P.prototype.createEl = HTMLElement.prototype.createEl;
			P.prototype.createDiv = HTMLElement.prototype.createDiv;
			P.prototype.createSpan = HTMLElement.prototype.createSpan;
			P.prototype.appendText = HTMLElement.prototype.appendText;
			P.prototype.addClass = HTMLElement.prototype.addClass;
		}
	}
	proto.setTextAlso = function (t) { this.textContent = String(t); };

	// Obsidian's own fixture helpers used by its tests, harmless here.
	window.Node.prototype.getText = window.Node.prototype.getText ?? function () { return this.textContent ?? ''; };
	window.Element.prototype.getText = window.Element.prototype.getText ?? function () { return this.textContent ?? ''; };
	return { Text };
}

module.exports = { install, applyDomElementInfo };
