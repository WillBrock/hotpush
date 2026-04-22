#!/usr/bin/env node

import { run } from '../lib/cli.js';

try {
	await run(process.argv);
}
catch(err) {
	console.error(`\n  \x1b[31m✘\x1b[0m ${err.message}\n`);
	process.exit(1);
}

process.on(`uncaughtException`, (err) => {
	console.error(`\n  \x1b[31m✘\x1b[0m Unexpected error: ${err.message}\n`);
	process.exit(1);
});

process.on(`unhandledRejection`, (err) => {
	console.error(`\n  \x1b[31m✘\x1b[0m Unhandled rejection: ${err.message || err}\n`);
	process.exit(1);
});
