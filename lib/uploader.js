import { execFile, spawn } from 'node:child_process';
import { posix } from 'node:path';
import { logger } from './logger.js';

function buildSshOpts(profile) {
	const opts = [
		`-o`, `StrictHostKeyChecking=accept-new`,
		`-o`, `BatchMode=yes`,
	];

	if(profile.agent) {
		opts.push(`-o`, `IdentityAgent=${profile.agent}`);
	}
	else if(profile.privateKey) {
		opts.push(`-i`, profile.privateKey);
	}

	return opts;
}

function exec(command, args, env_overrides) {
	return new Promise((resolve, reject) => {
		const options = { timeout : 30000 };

		if(env_overrides) {
			options.env = { ...process.env, ...env_overrides };
		}

		execFile(command, args, options, (error, stdout, stderr) => {
			if(error) {
				reject(new Error(stderr.trim() || error.message));
			}
			else {
				resolve(stdout);
			}
		});
	});
}

export class Uploader {
	constructor(profile, { ignore = [] } = {}) {
		this.profile = profile;
		this.ignore = ignore;
		this.queue = [];
		this.processing = false;
		this.aborted = false;
		this.created_dirs = new Set();
	}

	getRemotePaths() {
		return this.profile.remotePaths || [this.profile.remotePath];
	}

	enqueue(file_event) {
		// Deduplicate: if the same file is already queued, skip
		const already_queued = this.queue.some(e => e.relative_path === file_event.relative_path);

		if(already_queued) {
			return;
		}

		this.queue.push(file_event);

		if(!this.processing) {
			this.processQueue();
		}
	}

	async processQueue() {
		this.processing = true;

		while(this.queue.length > 0 && !this.aborted) {
			const task = this.queue.shift();

			try {
				await this.uploadFile(task);
			}
			catch(err) {
				logger.error(`Upload failed: ${task.relative_path} → ${this.profile.host}\n            ${err.message}`);
			}
		}

		this.processing = false;
	}

	async uploadFile(file_event) {
		const { host, username, port } = this.profile;
		const ssh_opts = buildSshOpts(this.profile);
		const env = this.profile.agent ? { SSH_AUTH_SOCK : this.profile.agent } : undefined;
		const normalized_relative_path = file_event.relative_path.replace(/\\/g, `/`);

		for(const remote_root of this.getRemotePaths()) {
			const remote_path = posix.join(remote_root, normalized_relative_path);
			const remote_dir = posix.dirname(remote_path);

			// Ensure remote directory exists
			if(!this.created_dirs.has(remote_dir)) {
				const mkdir_args = [
					...ssh_opts,
					`-p`, String(port),
					`${username}@${host}`,
					`mkdir -p "${remote_dir}"`,
				];

				await exec(`ssh`, mkdir_args, env);

				// Cache this directory and all parents
				let dir = remote_dir;

				while(dir && dir !== `/` && dir !== `.`) {
					this.created_dirs.add(dir);
					dir = posix.dirname(dir);
				}
			}

			// Upload via scp
			const scp_args = [
				...ssh_opts,
				`-P`, String(port),
				file_event.full_path,
				`${username}@${host}:${remote_path}`,
			];

			await exec(`scp`, scp_args, env);

			logger.upload(file_event.relative_path, host, remote_path);
		}
	}

	async sync(local_root) {
		const { host, username, port } = this.profile;
		const ssh_opts = buildSshOpts(this.profile);
		const ssh_cmd = [`ssh`, `-p`, String(port), ...ssh_opts].join(` `);
		const env = this.profile.agent ? { SSH_AUTH_SOCK : this.profile.agent } : undefined;

		for(const remote_path of this.getRemotePaths()) {
			const args = [
				`-avz`,
				`--progress`,
				`-e`, ssh_cmd,
			];

			for(const pattern of this.ignore) {
				args.push(`--exclude`, pattern);
			}

			// Trailing slash means "contents of directory"
			const source = local_root.endsWith(`/`) ? local_root : local_root + `/`;
			args.push(source);
			args.push(`${username}@${host}:${remote_path}/`);

			logger.info(`Syncing ${local_root} → ${host}:${remote_path}...`);

			await new Promise((resolve, reject) => {
				const spawn_opts = { stdio : [`ignore`, `pipe`, `pipe`] };

				if(env) {
					spawn_opts.env = { ...process.env, ...env };
				}

				const child = spawn(`rsync`, args, spawn_opts);

				child.stderr.on(`data`, (data) => {
					const msg = data.toString().trim();

					if(msg) {
						logger.warn(msg);
					}
				});

				child.on(`close`, (code) => {
					if(code === 0) {
						logger.success(`Sync complete → ${host}:${remote_path}`);
						resolve();
					}
					else {
						reject(new Error(`rsync exited with code ${code}`));
					}
				});
			});
		}
	}

	drain() {
		this.aborted = true;
		this.queue.length = 0;
	}
}
