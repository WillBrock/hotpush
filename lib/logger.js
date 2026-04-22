const is_tty = process.stdout.isTTY && !process.env.NO_COLOR;

const colors = is_tty ? {
	reset   : `\x1b[0m`,
	bold    : `\x1b[1m`,
	dim     : `\x1b[2m`,
	red     : `\x1b[31m`,
	green   : `\x1b[32m`,
	yellow  : `\x1b[33m`,
	blue    : `\x1b[34m`,
	cyan    : `\x1b[36m`,
	magenta : `\x1b[35m`,
} : {
	reset   : ``,
	bold    : ``,
	dim     : ``,
	red     : ``,
	green   : ``,
	yellow  : ``,
	blue    : ``,
	cyan    : ``,
	magenta : ``,
};

function timestamp() {
	return new Date().toLocaleTimeString(`en-US`, { hour12 : false });
}

function prefix(color, symbol) {
	return `  ${colors.dim}${timestamp()}${colors.reset}  ${color}${symbol}${colors.reset}`;
}

export const logger = {
	info(msg) {
		console.log(`${prefix(colors.cyan, `▶`)} ${msg}`);
	},

	success(msg) {
		console.log(`${prefix(colors.green, `✔`)} ${msg}`);
	},

	warn(msg) {
		console.log(`${prefix(colors.yellow, `⚠`)} ${msg}`);
	},

	error(msg) {
		console.error(`${prefix(colors.red, `✘`)} ${msg}`);
	},

	upload(file, host) {
		console.log(`${prefix(colors.green, `↑`)} ${colors.bold}${file}${colors.reset} ${colors.dim}→${colors.reset} ${colors.cyan}${host}${colors.reset}`);
	},

	banner(text) {
		console.log(`\n  ${colors.bold}${text}${colors.reset}\n`);
	},

	dim(msg) {
		console.log(`  ${colors.dim}${msg}${colors.reset}`);
	},
};
