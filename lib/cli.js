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
    hotpush --profile <name> [--profile <name>] [--watch <dirs...>] [--sync]
    hotpush init

  Commands:
    init                  Create a starter config file at ~/.hotpush.json

  Options:
    --profile <name>      Server profile to upload to (repeatable for multiple)
    --watch <dirs...>     Directories to watch (default: current directory)
    --sync                Full rsync upload before starting the watcher
    --help, -h            Show this help message
    --version, -v         Show version number

  Examples:
    hotpush --profile dev
    hotpush --profile dev --profile sandbox
    hotpush --profile dev --watch src/ modules/
    hotpush --profile dev --sync
`);
}

function normalizeRelativePath(file_path) {
	return file_path.replace(/\\/g, `/`);
}

function routePathMapEvent(file_event, routes) {
	const normalized_relative_path = normalizeRelativePath(file_event.relative_path);

	for(const route of routes) {
		if(normalized_relative_path === route.localPath || normalized_relative_path.startsWith(`${route.localPath}/`)) {
			const mapped_relative_path = normalized_relative_path === route.localPath
				? ``
				: normalized_relative_path.slice(route.localPath.length + 1);

			if(!mapped_relative_path) {
				return null;
			}

			return {
				uploader   : route.uploader,
				file_event : {
					...file_event,
					display_path  : file_event.relative_path,
					relative_path : mapped_relative_path,
				},
			};
		}
	}

	return null;
}

function buildUploadTargets(profiles, watch_dirs, ignore) {
	const upload_targets = [];

	for(const profile of profiles) {
		if(profile.pathMapEntries) {
			if(watch_dirs.length !== 1) {
				throw new Error(`Profile "${profile.name}" uses "pathMap" and requires exactly one watched directory.`);
			}

			const routes = profile.pathMapEntries.map((entry) => {
				const target_profile = {
					...profile,
					remotePath  : entry.remotePath,
					remotePaths : [entry.remotePath],
				};

				return {
					localPath : entry.localPath,
					uploader  : new Uploader(target_profile, { ignore }),
				};
			});

			upload_targets.push({
				type      : `path_map`,
				watch_dir : watch_dirs[0],
				profile,
				routes,
			});

			continue;
		}

		const remote_paths = profile.remotePaths || [profile.remotePath];

		if(remote_paths.length > 1 && remote_paths.length !== watch_dirs.length) {
			throw new Error(`Profile "${profile.name}" has ${remote_paths.length} remotePath entries, but ${watch_dirs.length} watched directories were provided. These counts must match.`);
		}

		for(const [index, watch_dir] of watch_dirs.entries()) {
			const remote_path = remote_paths.length === 1 ? remote_paths[0] : remote_paths[index];
			const target_profile = {
				...profile,
				remotePath  : remote_path,
				remotePaths : [remote_path],
			};

			upload_targets.push({
				type      : `fixed`,
				watch_dir,
				uploader : new Uploader(target_profile, { ignore }),
			});
		}
	}

	return upload_targets;
}

function getAllUploaders(upload_targets) {
	return upload_targets.flatMap((target) => {
		if(target.type === `path_map`) {
			return target.routes.map(route => route.uploader);
		}

		return [target.uploader];
	});
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
		throw new Error(`Unknown command: ${args.command}\nRun "hotpush --help" for usage.`);
	}

	if(args.profiles.length === 0) {
		throw new Error(`At least one --profile is required.\nRun "hotpush --help" for usage.`);
	}

	const config = loadConfig();
	const profiles = getProfiles(config, args.profiles);

	// Resolve watch directories
	const watch_dirs = args.watch_dirs.length > 0
		? args.watch_dirs.map(d => resolve(d))
		: [process.cwd()];

	const upload_targets = buildUploadTargets(profiles, watch_dirs, config.ignore);

	// Run initial sync if requested
	if(args.sync) {
		for(const target of upload_targets) {
			if(target.type === `path_map`) {
				for(const route of target.routes) {
					await route.uploader.sync(resolve(target.watch_dir, route.localPath));
				}
			}
			else {
				await target.uploader.sync(target.watch_dir);
			}
		}
	}

	// Create watchers
	const watchers = [];

	for(const dir of watch_dirs) {
		const watch_targets = upload_targets.filter(target => target.watch_dir === dir);

		const watcher = new Watcher(dir, {
			ignore      : config.ignore,
			debounce_ms : 300,
		});

		watcher.on((event) => {
			for(const target of watch_targets) {
				if(target.type === `path_map`) {
					const routed_event = routePathMapEvent(event, target.routes);

					if(routed_event) {
						routed_event.uploader.enqueue(routed_event.file_event);
					}
				}
				else {
					target.uploader.enqueue(event);
				}
			}
		});

		watcher.start();
		watchers.push(watcher);
	}

	// Print startup banner
	logger.banner(`hotpush v${pkg.version}`);

	const profile_list = profiles.map(p => `${p.name} (${p.host})`).join(`, `);
	logger.dim(`Profiles:   ${profile_list}`);

	for(const target of upload_targets) {
		if(target.type === `path_map`) {
			for(const route of target.routes) {
				logger.dim(`Watching:   ${resolve(target.watch_dir, route.localPath)} → ${route.uploader.profile.host}:${route.uploader.profile.remotePath}`);
			}
		}
		else {
			logger.dim(`Watching:   ${target.watch_dir} → ${target.uploader.profile.host}:${target.uploader.profile.remotePath}`);
		}
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

		for(const uploader of getAllUploaders(upload_targets)) {
			uploader.drain();
		}

		process.exit(0);
	}

	process.on(`SIGINT`, shutdown);
	process.on(`SIGTERM`, shutdown);
}
