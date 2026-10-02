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
		return 'Linked note: ' + node.file.replace(/\.md$/, '');
	}
	if (node.type === 'link' && node.url) {
		return 'Link: ' + node.url;
	}
	return null;
}

export function parseCanvasContent(rawJson: string): string {
	let data: CanvasData;
	try {
		data = JSON.parse(rawJson) as CanvasData;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return '(Canvas parse error: ' + msg + ')';
	}

	const nodes = data.nodes ?? [];
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
