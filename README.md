# autopush

Zero-dependency file watcher that auto-uploads changes to remote servers via SCP.

Watch local directories for file changes and automatically push them to one or more remote servers. No npm dependencies — just Node.js built-ins and standard SSH tools.

## Install

```bash
npm install -g autopush
```

Requires Node.js 18+ and `scp`/`ssh` in your PATH. For `--sync`, `rsync` is also required.

> **Linux users:** Recursive file watching requires Node.js 19.8+.

## Quick Start

```bash
# Create a config file
autopush init

# Edit ~/.autopush.json with your server details
# Then start watching
autopush --profile myserver
```

## Config

Config lives at `~/.autopush.json`. Top-level fields are shared defaults; profiles inherit them and can override.

```json
{
  "username": "will",
  "agent": "$SSH_AUTH_SOCK",
  "privateKey": "~/.ssh/id_rsa",
  "ignore": [
    "node_modules",
    ".git",
    ".svn",
    ".DS_Store",
    ".vscode"
  ],
  "profiles": {
    "lab": {
      "host": "lab.example.com",
      "remotePath": "/var/www/project"
    },
    "testing": {
      "host": "testing.example.com",
      "remotePath": "/var/www/project",
      "username": "deploy"
    }
  }
}
```

### Top-level fields (shared defaults)

| Field | Default | Description |
|---|---|---|
| `username` | OS username | SSH username for all profiles |
| `agent` | — | SSH agent socket (e.g. `$SSH_AUTH_SOCK`) |
| `privateKey` | `~/.ssh/id_rsa` | Path to SSH private key |
| `port` | `22` | SSH port |
| `ignore` | `["node_modules", ".git", ".svn", ".DS_Store"]` | Paths/segments to ignore |

### Profile fields

| Field | Required | Description |
|---|---|---|
| `host` | Yes | Server hostname or IP |
| `remotePath` | Yes | Remote base directory |
| `username` | No | Override top-level username |
| `privateKey` | No | Override top-level key |
| `agent` | No | Override top-level agent |
| `port` | No | Override top-level port |

### Ignore patterns

Ignore patterns support two styles:

- **Segment match** — `node_modules` matches any path containing a `node_modules` segment
- **Path prefix** — `focus-automation/node_modules` matches only that specific nested path

## Usage

```bash
# Watch current directory, upload to one profile
autopush --profile lab

# Upload to multiple servers simultaneously
autopush --profile lab --profile testing

# Watch specific directories only
autopush --profile lab --watch src/ modules/

# Full rsync sync first, then watch for changes
autopush --profile lab --sync

# Create starter config file
autopush init

# Show help
autopush --help
```

## How it works

1. Watches specified directories (or CWD) using Node.js `fs.watch` with recursive mode
2. When a file changes, debounces for 300ms to coalesce rapid saves
3. Verifies the file still exists (skips deletions — upload only)
4. Uploads via `scp` to each active profile's remote server
5. Mirrors the local relative path structure on the remote (e.g. `src/foo.js` → `remotePath/src/foo.js`)
6. Creates remote directories as needed via `ssh mkdir -p`

Each profile has its own serial upload queue with deduplication, so uploads to different servers happen in parallel while individual servers are never overwhelmed.

## Publishing to npm

```bash
# Login to npm (one-time)
npm login

# Publish
npm publish

# After publishing, anyone can install with:
npm install -g autopush
```

## License

MIT
