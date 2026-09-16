/**
 * Markdown cleaner utility.
 * Removes comments, cleans extra newlines, handles admonitions/callouts.
 */

export function removeComments(content: string): string {
	return content.replace(/%%[\s\S]*?%%/g, '');
}

export function cleanCallouts(content: string): string {
	return content.replace(/^>\s*\[!([A-Za-z_-]+)\](?:[ \t]*(.*))?$/gm, (_match, type, title) => {
		const calloutTitle = title ? ': ' + title : '';
		return '> **[' + type.toUpperCase() + calloutTitle + ']**';
	});
}

export function sanitizeWhitespace(content: string): string {
	return content
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}