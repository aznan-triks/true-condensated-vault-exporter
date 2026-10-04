/**
 * Canvas Parser logic.
 * Parses Obsidian .canvas JSON files and extracts structured text.
 * Nodes are emitted in visual reading order (top-to-bottom, left-to-right);
 * group labels become section headers when present.
 */

export interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	text?: string;
	file?: string;
	url?: string;
	label?: string;
	color?: string;
	/** Optional id of the group node this node belongs to */
	group?: string;
	position?: { x: number; y: number };
}

export interface CanvasData {
	nodes?: CanvasNode[];
	edges?: unknown[];
}

interface PositionedNode {
	node: CanvasNode;
	x: number;
	y: number;
}

function nodeLine(node: CanvasNode): string | null {
	if (node.type === 'text' && node.text) {
		const trimmed = node.text.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (node.type === 'file' && node.file) {
		return 'Linked note: ' + node.file.replace(/\.md$/i, '');
	}
	if (node.type === 'link' && node.url) {
		return 'Link: ' + node.url;
	}
	return null;
}

function isCanvasNode(value: unknown): value is CanvasNode {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const node = value as Record<string, unknown>;
	if (typeof node.id !== 'string' || !['text', 'file', 'link', 'group'].includes(String(node.type))) return false;
	if (node.type === 'text' && typeof node.text !== 'string') return false;
	if (node.type === 'file' && typeof node.file !== 'string') return false;
	if (node.type === 'link' && typeof node.url !== 'string') return false;
	if (node.type === 'group' && node.label !== undefined && typeof node.label !== 'string') return false;
	if (node.group !== undefined && typeof node.group !== 'string') return false;
	if (node.position !== undefined) {
		if (!node.position || typeof node.position !== 'object') return false;
		const position = node.position as Record<string, unknown>;
		if (typeof position.x !== 'number' || typeof position.y !== 'number') return false;
	}
	return true;
}

export function parseCanvasContent(rawJson: string): string {
	let data: unknown;
	try {
		data = JSON.parse(rawJson) as unknown;
	} catch {
		return '(Invalid canvas JSON)';
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return '(Invalid canvas: expected a JSON object)';
	}
	const rawNodes = (data as CanvasData).nodes;
	if (rawNodes !== undefined && !Array.isArray(rawNodes)) {
		return '(Invalid canvas: nodes must be an array)';
	}
	const nodes = (rawNodes ?? []).filter(isCanvasNode);
	if (nodes.length === 0) {
		return '(Empty canvas)';
	}

	// Group labels, referenced by node.group
	const groupLabels = new Map<string, string>();
	for (const node of nodes) {
		if (node.type === 'group' && node.id) {
			groupLabels.set(node.id, node.label ?? '');
		}
	}

	const contentNodes: PositionedNode[] = nodes
		.filter((n) => n.type !== 'group')
		.map((n) => ({ node: n, x: n.position?.x ?? 0, y: n.position?.y ?? 0 }));

	// Reading order: top-to-bottom, then left-to-right
	contentNodes.sort((a, b) => (a.y - b.y) || (a.x - b.x));

	const parts: string[] = [];
	let lastEmittedGroup = '';

	for (const { node } of contentNodes) {
		const line = nodeLine(node);
		if (!line) continue;

		const groupId = node.group ?? '';
		const groupLabel = groupLabels.get(groupId) ?? '';
		// Enter a group: section header. Ungrouped nodes just continue the flow;
		// leaving and re-entering the same group does not duplicate the header.
		if (groupLabel && groupLabel !== lastEmittedGroup) {
			parts.push('## ' + groupLabel);
			lastEmittedGroup = groupLabel;
		}

		parts.push(line);
	}

	return parts.length > 0 ? parts.join('\n\n') : '(Empty canvas)';
}
