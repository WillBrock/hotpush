import { watch } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { logger } from './logger.js';

export class Watcher {
	constructor(directory, { ignore = [], debounce_ms = 300 } = {}) {
		this.directory = directory;
		this.ignore_patterns = ignore;
		this.debounce_ms = debounce_ms;
		this.timers = new Map();
		this.listeners = [];
		this.fs_watcher = null;
	}

	start() {
		this.fs_watcher = watch(this.directory, { recursive : true }, (event_type, filename) => {
			this.handleEvent(event_type, filename);
		});

		this.fs_watcher.on(`error`, (err) => {
			logger.error(`Watcher error on ${this.directory}: ${err.message}`);
		});
	}

	handleEvent(event_type, filename) {
		if(!filename) {
			return;
		}

		if(this.shouldIgnore(filename)) {
			return;
		}

		// Clear existing debounce timer for this file
		if(this.timers.has(filename)) {
			clearTimeout(this.timers.get(filename));
		}

		const timer = setTimeout(async () => {
			this.timers.delete(filename);

			const full_path = join(this.directory, filename);

			try {
				const file_stat = await stat(full_path);

				if(!file_stat.isFile()) {
					return;
				}

				const event = {
					full_path,
					relative_path : filename,
					directory     : this.directory,
				};

				for(const listener of this.listeners) {
					listener(event);
				}
			}
			catch {
				// File was deleted or is a transient temp file — skip silently
			}
		}, this.debounce_ms);

		this.timers.set(filename, timer);
	}

	shouldIgnore(filename) {
		const segments = filename.split(sep);

		for(const pattern of this.ignore_patterns) {
			// Path prefix match: "tools/node_modules" matches as a substring of the path
			if(pattern.includes(sep) || pattern.includes(`/`)) {
				const normalized = pattern.replace(/\//g, sep);

				if(filename.startsWith(normalized + sep) || filename === normalized) {
					return true;
				}

				continue;
			}

			// Segment match: ".git" matches any path segment named ".git"
			if(segments.includes(pattern)) {
				return true;
			}
		}

		return false;
	}

	on(callback) {
		this.listeners.push(callback);

		return () => {
			const index = this.listeners.indexOf(callback);

			if(index !== -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	close() {
		if(this.fs_watcher) {
			this.fs_watcher.close();
			this.fs_watcher = null;
		}

		for(const timer of this.timers.values()) {
			clearTimeout(timer);
		}

		this.timers.clear();
	}
}
