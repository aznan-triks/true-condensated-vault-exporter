'use strict';
module.exports = { shell: { showItemInFolder: (p) => require('./obsidian-mock.cjs').__state.revealCalls.push(p), openPath: async () => '' } };
