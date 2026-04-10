# Simple Worker Example

Minimal example of an external worker for the Industream Platform.

## Usage

```bash
industream worker add ./examples/simple-worker
industream worker list
industream worker remove simple-worker
```

## Manifest format (`industream.yaml`)

| Field | Required | Description |
|---|---|---|
| `apiVersion` | Yes | Must be `industream.com/v1` |
| `kind` | Yes | Must be `Worker` |
| `metadata.name` | Yes | Unique worker name (used as Docker service name) |
| `metadata.version` | Yes | Semver version string |
| `metadata.author` | Yes | Author or organization |
| `metadata.description` | No | Human-readable description |
| `spec.image.ref` | One of ref/file/dockerfile | Pre-built image reference |
| `spec.image.file` | One of ref/file/dockerfile | Local tar.gz archive path |
| `spec.image.dockerfile` | One of ref/file/dockerfile | Path to Dockerfile for build |
| `spec.resources.limits.cpus` | No | CPU limit (e.g. `"0.5"`) |
| `spec.resources.limits.memory` | No | Memory limit (e.g. `"256M"`) |
| `spec.environment` | No | Extra environment variables |
| `spec.replicas` | No | Number of replicas (default: 1) |

## Image strategies

### 1. Registry reference (recommended)

```yaml
spec:
  image:
    ref: registry.example.com/workers/my-worker:1.0.0
```

### 2. Local tar.gz archive

```yaml
spec:
  image:
    file: image.tar.gz
```

### 3. Build from Dockerfile

```yaml
spec:
  image:
    dockerfile: Dockerfile
```
