'use strict';

// Electron surface used by the plugin: the shell (reveal / open a path) and
// the native folder picker. `__state` lives in the Obsidian mock so scenarios
// can pre-seed the folder the dialog returns.
const state = () => require('./obsidian-mock.cjs').__state;

module.exports = {
	shell: {
		showItemInFolder: (p) => state().revealCalls.push(p),
		openPath: async (p) => {
			state().openPathCalls.push(p);
			return '';
		},
	},
	dialog: {
		showOpenDialog: async (options) => {
			const current = state();
			if (current.folderPickerCanceled) return { canceled: true, filePaths: [] };
			const picked = current.pickedFolder ?? options?.defaultPath ?? process.cwd();
			return { canceled: false, filePaths: [picked] };
		},
	},
};
