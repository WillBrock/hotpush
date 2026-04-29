import { readFileSync, writeFileSync, accessSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { logger } from './logger.js';

export const CONFIG_PATH = join(homedir(), `.hotpush.json`);

const DEFAULT_IGNORE = [
	`node_modules`,
	`.git`,
	`.svn`,
	`.DS_Store`,
];

function expandTilde(value) {
	if(typeof value === `string` && value.startsWith(`~`)) {
		return join(homedir(), value.slice(1));
	}

	return value;
}

function expandEnvVars(value) {
	if(typeof value !== `string`) {
		return value;
	}

	return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, name) => {
		return process.env[name] || match;
	});
}

function normalizeRemotePath(name, field_name, remote_path) {
	if(typeof remote_path !== `string`) {
		throw new Error(`Profile "${name}" field "${field_name}" must be a string.`);
	}

	const trimmed_path = remote_path.trim();

	if(!trimmed_path) {
		throw new Error(`Profile "${name}" has an empty "${field_name}" value.`);
	}

	return expandTilde(trimmed_path);
}

function normalizeRemotePaths(name, remote_path) {
	if(typeof remote_path === `string`) {
		return [normalizeRemotePath(name, `remotePath`, remote_path)];
	}

	if(Array.isArray(remote_path)) {
		if(remote_path.length === 0) {
			throw new Error(`Profile "${name}" must have at least one "remotePath" value.`);
		}

		const normalized_paths = remote_path.map((path, index) => {
			return normalizeRemotePath(name, `remotePath[${index}]`, path);
		});

		return [...new Set(normalized_paths)];
	}

	throw new Error(`Profile "${name}" field "remotePath" must be a string or array of strings.`);
}

function normalizePathMapKey(name, local_path) {
	if(typeof local_path !== `string`) {
		throw new Error(`Profile "${name}" has a non-string "pathMap" key.`);
	}

	const normalized_path = local_path
		.trim()
		.replace(/\\/g, `/`)
		.replace(/^\.\//, ``)
		.replace(/^\/+/, ``)
		.replace(/\/+$/, ``);

	if(!normalized_path) {
		throw new Error(`Profile "${name}" has an empty "pathMap" key.`);
	}

	return normalized_path;
}

function normalizePathMap(name, path_map) {
	if(!path_map || typeof path_map !== `object` || Array.isArray(path_map)) {
		throw new Error(`Profile "${name}" field "pathMap" must be an object mapping local paths to remote paths.`);
	}

	const entries = Object.entries(path_map);

	if(entries.length === 0) {
		throw new Error(`Profile "${name}" field "pathMap" must have at least one entry.`);
	}

	const seen_paths = new Set();
	const normalized_entries = entries.map(([local_path, remote_path]) => {
		const normalized_local_path = normalizePathMapKey(name, local_path);

		if(seen_paths.has(normalized_local_path)) {
			throw new Error(`Profile "${name}" has duplicate "pathMap" entries for "${normalized_local_path}".`);
		}

		seen_paths.add(normalized_local_path);

		return {
			localPath  : normalized_local_path,
			remotePath : normalizeRemotePath(name, `pathMap.${local_path}`, remote_path),
		};
	});

	return normalized_entries.sort((a, b) => {
		return b.localPath.length - a.localPath.length;
	});
}

export function loadConfig() {
	try {
		accessSync(CONFIG_PATH);
	}
	catch {
		throw new Error(`Config file not found at ${CONFIG_PATH}\nRun "hotpush init" to create one.`);
	}

	let raw;

	try {
		raw = readFileSync(CONFIG_PATH, `utf8`);
	}
	catch(err) {
		throw new Error(`Failed to read config file: ${err.message}`);
	}

	let config;

	try {
		config = JSON.parse(raw);
	}
	catch(err) {
		throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${err.message}`);
	}

	if(!config.profiles || typeof config.profiles !== `object` || Object.keys(config.profiles).length === 0) {
		throw new Error(`Config must have at least one profile in "profiles".`);
	}

	const top_level_username = config.username || userInfo().username;
	const top_level_agent = config.agent ? expandEnvVars(config.agent) : null;
	const top_level_private_key = config.privateKey ? expandTilde(config.privateKey) : expandTilde(`~/.ssh/id_rsa`);
	const top_level_port = config.port || 22;

	for(const [name, profile] of Object.entries(config.profiles)) {
		if(!profile.host) {
			throw new Error(`Profile "${name}" is missing required field "host".`);
		}

		const has_remote_path = profile.remotePath !== undefined;
		const has_path_map = profile.pathMap !== undefined;

		if(!has_remote_path && !has_path_map) {
			throw new Error(`Profile "${name}" must define either "remotePath" or "pathMap".`);
		}

		if(has_remote_path && has_path_map) {
			throw new Error(`Profile "${name}" must use either "remotePath" or "pathMap", not both.`);
		}

		profile.username = profile.username || top_level_username;
		profile.port = profile.port || top_level_port;
		profile.remotePaths = has_remote_path ? normalizeRemotePaths(name, profile.remotePath) : null;
		profile.pathMapEntries = has_path_map ? normalizePathMap(name, profile.pathMap) : null;

		if(profile.agent !== undefined) {
			profile.agent = expandEnvVars(profile.agent);
		}
		else if(top_level_agent) {
			profile.agent = top_level_agent;
		}

		if(profile.privateKey !== undefined) {
			profile.privateKey = expandTilde(profile.privateKey);
		}
		else {
			profile.privateKey = top_level_private_key;
		}

		// Warn if private key doesn't exist and no agent is configured
		if(!profile.agent) {
			try {
				accessSync(profile.privateKey);
			}
			catch {
				logger.warn(`SSH key "${profile.privateKey}" not found for profile "${name}" — ssh-agent may still work.`);
			}
		}
	}

	config.ignore = config.ignore || DEFAULT_IGNORE;

	return config;
}

export function getProfiles(config, profile_names) {
	const profiles = [];
	const available = Object.keys(config.profiles);

	for(const name of profile_names) {
		const profile = config.profiles[name];

		if(!profile) {
			throw new Error(`Profile "${name}" not found. Available profiles: ${available.join(`, `)}`);
		}

		profiles.push({ ...profile, name });
	}

	return profiles;
}

export function createDefaultConfig() {
	try {
		accessSync(CONFIG_PATH);
		logger.warn(`Config file already exists at ${CONFIG_PATH}`);
		return;
	}
	catch {
		// File doesn't exist, we can create it
	}

	const template = {
		_auth      : `Use "agent" OR "privateKey" for authentication, not both`,
		username   : userInfo().username,
		agent      : `$SSH_AUTH_SOCK`,
		ignore     : DEFAULT_IGNORE,
		profiles   : {
			example : {
				host       : `example.com`,
				remotePath : `/var/www/project`,
			},
		},
	};

	writeFileSync(CONFIG_PATH, JSON.stringify(template, null, `\t`) + `\n`, {
		mode : 0o600,
	});

	logger.success(`Config file created at ${CONFIG_PATH}`);
	logger.info(`Edit it to add your server profiles, then run hotpush --profile <name>`);
}
