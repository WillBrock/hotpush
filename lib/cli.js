import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig, getProfiles, createDefaultConfig } from './config.js';
import { Watcher } from './watcher.js';
import { Uploader } from './uploader.js';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

function parseArgs(argv) {
	const args = argv.slice(2);

	const result = {
		profiles   : [],
		watch_dirs : [],
		sync       : false,
		command    : null,
		help       : false,
		version    : false,
	};

	let i = 0;

	// Check for subcommand
	if(args.length > 0 && !args[0].startsWith(`--`)) {
		result.command = args[0];
		i = 1;
	}

	while(i < args.length) {
		const arg = args[i];

		switch(arg) {
			case `--profile`:
				i++;

				if(i >= args.length) {
					throw new Error(`--profile requires a value`);
				}

				result.profiles.push(args[i]);
				break;

			case `--watch`:
				i++;

				while(i < args.length && !args[i].startsWith(`--`)) {
					result.watch_dirs.push(args[i]);
					i++;
				}

				continue;

			case `--sync`:
				result.sync = true;
				break;

			case `--help`:
			case `-h`:
				result.help = true;
				break;

			case `--version`:
			case `-v`:
				result.version = true;
				break;

			default:
				throw new Error(`Unknown option: ${arg}`);
		}

		i++;
	}

	return result;
}

function printHelp() {
	console.log(`
  ${pkg.name} v${pkg.version}
  ${pkg.description}

  Usage:
    autopush --profile <name> [--profile <name>] [--watch <dirs...>] [--sync]
    autopush init

  Commands:
    init                  Create a starter config file at ~/.autopush.json

  Options:
    --profile <name>      Server profile to upload to (repeatable for multiple)
    --watch <dirs...>     Directories to watch (default: current directory)
    --sync                Full rsync upload before starting the watcher
    --help, -h            Show this help message
    --version, -v         Show version number

  Examples:
    autopush --profile lab
    autopush --profile lab --profile testing
    autopush --profile lab --watch src/ modules/
    autopush --profile lab --sync
`);
}

export async function run(argv) {
	const args = parseArgs(argv);

	if(args.help) {
		printHelp();
		return;
	}

	if(args.version) {
		console.log(pkg.version);
		return;
	}

	if(args.command === `init`) {
		createDefaultConfig();
		return;
	}

	if(args.command) {
		throw new Error(`Unknown command: ${args.command}\nRun "autopush --help" for usage.`);
	}

	if(args.profiles.length === 0) {
		throw new Error(`At least one --profile is required.\nRun "autopush --help" for usage.`);
	}

	const config = loadConfig();
	const profiles = getProfiles(config, args.profiles);

	// Resolve watch directories
	const watch_dirs = args.watch_dirs.length > 0
		? args.watch_dirs.map(d => resolve(d))
		: [process.cwd()];

	// Create uploaders for each profile
	const uploaders = profiles.map(p => new Uploader(p, { ignore : config.ignore }));

	// Run initial sync if requested
	if(args.sync) {
		for(const uploader of uploaders) {
			for(const dir of watch_dirs) {
				await uploader.sync(dir);
			}
		}
	}

	// Create watchers
	const watchers = [];

	for(const dir of watch_dirs) {
		const watcher = new Watcher(dir, {
			ignore      : config.ignore,
			debounce_ms : 300,
		});

		watcher.on((event) => {
			for(const uploader of uploaders) {
				uploader.enqueue(event);
			}
		});

		watcher.start();
		watchers.push(watcher);
	}

	// Print startup banner
	logger.banner(`autopush v${pkg.version}`);

	const profile_list = profiles.map(p => `${p.name} (${p.host})`).join(`, `);
	logger.dim(`Profiles:   ${profile_list}`);

	for(const dir of watch_dirs) {
		logger.dim(`Watching:   ${dir}`);
	}

	if(config.ignore.length > 0) {
		logger.dim(`Ignoring:   ${config.ignore.join(`, `)}`);
	}

	console.log();
	logger.info(`Ready. Watching for changes...`);
	console.log();

	// Graceful shutdown
	function shutdown() {
		console.log();
		logger.info(`Shutting down...`);

		for(const watcher of watchers) {
			watcher.close();
		}

		for(const uploader of uploaders) {
			uploader.drain();
		}

		process.exit(0);
	}

	process.on(`SIGINT`, shutdown);
	process.on(`SIGTERM`, shutdown);
}
