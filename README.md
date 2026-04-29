# hotpush

Zero-dependency file watcher that auto-uploads changes to remote servers via SCP.

Watch local directories for file changes and automatically push them to one or more remote servers. No npm dependencies — just Node.js built-ins and standard SSH tools.

## Install

```bash
npm install -g hotpush
```

Requires Node.js 18+ and `scp`/`ssh` in your PATH. For `--sync`, `rsync` is also required.

> **Linux users:** Recursive file watching requires Node.js 19.8+.

## Quick Start

```bash
# Create a config file
hotpush init

# Edit ~/.hotpush.json with your server details
# Then start watching
hotpush --profile myserver
```

## Config

Config lives at `~/.hotpush.json`. Top-level fields are shared defaults; profiles inherit them and can override.

```json
{
  "username": "john",
  "agent": "$SSH_AUTH_SOCK",
  "ignore": [
    "node_modules",
    ".git",
    ".svn",
    ".DS_Store",
    ".vscode"
  ],
  "profiles": {
    "dev": {
      "host": "dev.example.com",
      "remotePath": "/var/www/project"
    },
    "sandbox": {
      "host": "sandbox.example.com",
      "remotePath": "/var/www/project",
      "username": "deploy"
    },
    "redirects": {
      "host": "redirects.example.com",
      "pathMap": {
        "School_Setup/SchoolWebsite": "/mnt/sftp/redirects/focus/School_Setup/SchoolWebsite",
        "classes/SchoolWebsite": "/mnt/sftp/redirects/focus/classes/SchoolWebsite",
        "assets/school-website": "/mnt/sftp/redirects/focus/assets/school-website",
        "AI": "/mnt/sftp/redirects/focus/AI"
      }
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

> **Note:** Use `agent` OR `privateKey` for authentication, not both. If you have an SSH agent running, use `agent`. Otherwise, point `privateKey` to your key file.
| `port` | `22` | SSH port |
| `ignore` | `["node_modules", ".git", ".svn", ".DS_Store"]` | Paths/segments to ignore |

### Profile fields

| Field | Required | Description |
|---|---|---|
| `host` | Yes | Server hostname or IP |
| `remotePath` | No* | Remote base directory, or an array of directories |
| `pathMap` | No* | Object mapping local subpaths to remote base directories |
| `username` | No | Override top-level username |
| `privateKey` | No | Override top-level key |
| `agent` | No | Override top-level agent |
| `port` | No | Override top-level port |

`*` Each profile must define exactly one of `remotePath` or `pathMap`.

### Multiple remote directories

`remotePath` accepts either:

- A string for the existing single-destination behavior
- An array of strings to map watched directories to remote directories by order

When you use a `remotePath` array, the number of remote paths must match the number of directories passed to `--watch`. Files from the first watched directory go to the first remote path, files from the second watched directory go to the second remote path, and so on.

Example:

```json
{
  "profiles": {
    "dev": {
      "host": "dev.example.com",
      "remotePath": [
        "/var/www/project/src",
        "/var/www/project/modules"
      ]
    }
  }
}
```

```bash
hotpush --profile dev --watch src/ modules/
```

### Path Map Routing

Use `pathMap` when you want to watch one project root and route different subtrees to different remote destinations.

Example:

```json
{
  "profiles": {
    "redirects": {
      "host": "redirects.example.com",
      "pathMap": {
        "School_Setup/SchoolWebsite": "/mnt/sftp/redirects/focus/School_Setup/SchoolWebsite",
        "classes/SchoolWebsite": "/mnt/sftp/redirects/focus/classes/SchoolWebsite",
        "assets/school-website": "/mnt/sftp/redirects/focus/assets/school-website",
        "AI": "/mnt/sftp/redirects/focus/AI"
      }
    }
  }
}
```

```bash
hotpush --profile redirects
```

With `pathMap`, hotpush watches the current directory once, then picks the matching remote destination based on the changed file's local path prefix.

### Ignore patterns

Ignore patterns support two styles:

- **Segment match** — `node_modules` matches any path containing a `node_modules` segment
- **Path prefix** — `tools/node_modules` matches only that specific nested path

## Usage

```bash
# Watch current directory, upload to one profile
hotpush --profile dev

# Upload to multiple servers simultaneously
hotpush --profile dev --profile sandbox

# Watch specific directories only
hotpush --profile dev --watch src/ modules/

# Full rsync sync first, then watch for changes
hotpush --profile dev --sync

# Create starter config file
hotpush init

# Show help
hotpush --help
```

## How it works

1. Watches specified directories (or CWD) using Node.js `fs.watch` with recursive mode
2. When a file changes, debounces for 300ms to coalesce rapid saves
3. Verifies the file still exists (skips deletions — upload only)
4. Uploads via `scp` to each active profile's remote server
5. Mirrors the local relative path structure on the remote (e.g. `src/foo.js` → `remotePath/src/foo.js`)
6. Creates remote directories as needed via `ssh mkdir -p`

Each profile has its own serial upload queue with deduplication, so uploads to different servers happen in parallel while individual servers are never overwhelmed.

If a profile uses an array for `remotePath`, each watched directory is paired with the remote path at the same index instead of broadcasting every file to every destination.

If a profile uses `pathMap`, files are routed by the longest matching local path prefix, so a change under `classes/SchoolWebsite/...` only uploads to that mapped remote base.

## Publishing to npm

```bash
# Login to npm (one-time)
npm login

# Publish
npm publish

# After publishing, anyone can install with:
npm install -g hotpush
```

## License

MIT
