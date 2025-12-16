# Docker Build & Push Scripts

This directory contains scripts to build, tag, and push the WarEra Discord Bot Docker image to a registry.

## Prerequisites

1. Docker installed and running
2. Docker registry credentials configured (logged in via `docker login`)
3. Both `WarEraBot` and `WarEraSDK` directories must be present in the parent directory

## Directory Structure

The scripts expect this structure:
```
parent-directory/
├── WarEraBot/          # This repository
│   ├── build-and-push.sh
│   ├── build-and-push.ps1
│   ├── Dockerfile
│   └── ...
└── WarEraSDK/          # Required dependency
    └── ...
```

## Usage

### Windows (PowerShell)

```powershell
# Basic usage
.\build-and-push.ps1 -Registry "docker.io/myuser"

# Custom image name
.\build-and-push.ps1 -Registry "ghcr.io/myorg" -ImageName "warera-bot"

# Don't push 'latest' tag
.\build-and-push.ps1 -Registry "docker.io/myuser" -PushLatest $false

# Build only (don't push)
.\build-and-push.ps1 -Registry "docker.io/myuser" -SkipPush

# Get help
.\build-and-push.ps1 -?
```

### Linux/Mac (Bash)

First, make the script executable:
```bash
chmod +x build-and-push.sh
```

Then run it:
```bash
# Basic usage
./build-and-push.sh -r docker.io/myuser

# Custom image name
./build-and-push.sh -r ghcr.io/myorg -n warera-bot

# Don't push 'latest' tag
./build-and-push.sh -r docker.io/myuser --no-latest

# Build only (don't push)
./build-and-push.sh -r docker.io/myuser --skip-push

# Get help
./build-and-push.sh --help
```

## What the Scripts Do

1. **Read version** from `package.json`
2. **Build Docker image** using `WarEraBot/Dockerfile`
3. **Tag image** with:
   - Version tag: `{registry}/{image-name}:{version}` (e.g., `docker.io/myuser/warera-discord-bot:1.0.0`)
   - Latest tag: `{registry}/{image-name}:latest` (optional)
4. **Push to registry** (unless `--skip-push` is specified)

## Docker Registry Examples

### Docker Hub
```bash
# Login first
docker login docker.io

# Build and push
./build-and-push.sh -r docker.io/yourusername
```

### GitHub Container Registry (GHCR)
```bash
# Login with GitHub token
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Build and push
./build-and-push.sh -r ghcr.io/yourorg
```

### Azure Container Registry (ACR)
```bash
# Login to ACR
az acr login --name myregistry

# Build and push
./build-and-push.sh -r myregistry.azurecr.io
```

### AWS Elastic Container Registry (ECR)
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789.dkr.ecr.us-east-1.amazonaws.com

# Build and push
./build-and-push.sh -r 123456789.dkr.ecr.us-east-1.amazonaws.com
```

## Running the Image

After pushing, you can run the image on any Docker host:

```bash
# Pull the image
docker pull docker.io/myuser/warera-discord-bot:1.0.0

# Run with environment file
docker run -d \
  --name warera-bot \
  --env-file .env \
  -v $(pwd)/servers.json:/app/servers.json \
  -v $(pwd)/battles.json:/app/battles.json \
  docker.io/myuser/warera-discord-bot:1.0.0
```

## Volumes

The bot uses two JSON files for persistence:
- `servers.json` - Server configurations
- `battles.json` - Battle message tracking

Mount these as volumes to persist data across container restarts:

```bash
docker run -d \
  --name warera-bot \
  --env-file .env \
  -v /path/to/servers.json:/app/servers.json \
  -v /path/to/battles.json:/app/battles.json \
  --restart unless-stopped \
  docker.io/myuser/warera-discord-bot:1.0.0
```

## Troubleshooting

### Build fails with "WarEraSDK not found"
Ensure the `WarEraSDK` directory exists in the parent directory alongside `WarEraBot`.

### Push fails with "unauthorized"
Run `docker login <registry>` before pushing.

### "Script not found" error on Linux/Mac
Make sure to make the script executable: `chmod +x build-and-push.sh`

### Build fails with "context" error
The script must be run from within the `WarEraBot` directory, as it changes to the parent directory for the Docker build.

## CI/CD Integration

You can integrate these scripts into your CI/CD pipeline:

### GitHub Actions Example
```yaml
- name: Build and Push Docker Image
  run: |
    echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
    ./build-and-push.sh -r ghcr.io/${{ github.repository_owner }}
  working-directory: ./WarEraBot
```

### GitLab CI Example
```yaml
build-and-push:
  script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY
    - cd WarEraBot
    - ./build-and-push.sh -r $CI_REGISTRY_IMAGE
```
