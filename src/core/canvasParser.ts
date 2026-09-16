/**
 * Canvas Parser logic.
 * Parses Obsidian .canvas JSON files and extracts structured text.
 */

export interface CanvasNode {
	id: string;
	type: 'text' | 'file' | 'link' | 'group';
	text?: string;
	file?: string;
	url?: string;
	label?: string;
}

export interface CanvasData {
	nodes?: CanvasNode[];
	edges?: unknown[];
}

export function parseCanvasContent(rawJson: string): string {
	try {
		const data: CanvasData = JSON.parse(rawJson);
		const nodes = data.nodes ?? [];
		if (nodes.length === 0) {
			return '(Canvas vide)';
		}

		const parts: string[] = [];
		for (const node of nodes) {
			if (node.type === 'text' && node.text) {
				const trimmed = node.text.trim();
				if (trimmed) {
					parts.push(trimmed);
				}
			} else if (node.type === 'file' && node.file) {
				const noteName = node.file.replace(/\.md$/, '');
				parts.push('Note liée : ' + noteName);
			} else if (node.type === 'link' && node.url) {
				parts.push('Lien : ' + node.url);
			}
		}

		return parts.length > 0 ? parts.join('\n\n') : '(Canvas vide)';
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return '(Erreur Canvas : ' + msg + ')';
	}
}