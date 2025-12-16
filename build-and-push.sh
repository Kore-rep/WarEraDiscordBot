#!/bin/bash

# WarEra Discord Bot - Build & Push Script
# This script builds the Docker image, tags it with version and 'latest',
# and pushes it to the specified Docker registry.

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="warera-discord-bot"
PUSH_LATEST=true
SKIP_PUSH=false

# Functions for colored output
function info() {
    echo -e "${CYAN}$1${NC}"
}

function success() {
    echo -e "${GREEN}$1${NC}"
}

function warning() {
    echo -e "${YELLOW}$1${NC}"
}

function error() {
    echo -e "${RED}$1${NC}"
}

# Show usage
function usage() {
    cat << EOF
Usage: $0 -r REGISTRY [OPTIONS]

Build, tag, and push the WarEra Discord Bot Docker image.

Required arguments:
  -r, --registry REGISTRY    Docker registry URL (e.g., docker.io/myuser, ghcr.io/myorg)

Optional arguments:
  -n, --name NAME           Docker image name (default: warera-discord-bot)
  -l, --no-latest           Don't push the 'latest' tag
  -s, --skip-push           Build and tag only, skip pushing to registry
  -h, --help                Show this help message

Examples:
  $0 -r docker.io/myuser
  $0 -r ghcr.io/myorg -n warera-bot --no-latest
  $0 -r docker.io/myuser --skip-push

EOF
}

# Parse command line arguments
REGISTRY=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -n|--name)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -l|--no-latest)
            PUSH_LATEST=false
            shift
            ;;
        -s|--skip-push)
            SKIP_PUSH=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ -z "$REGISTRY" ]; then
    error "Error: Registry is required"
    usage
    exit 1
fi

info "========================================"
info "WarEra Discord Bot - Build & Push Script"
info "========================================"

# Get script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Read version from package.json
PACKAGE_JSON="$SCRIPT_DIR/package.json"
if [ ! -f "$PACKAGE_JSON" ]; then
    error "Error: package.json not found at $PACKAGE_JSON"
    exit 1
fi

VERSION=$(grep -m 1 '"version"' "$PACKAGE_JSON" | sed 's/.*"version": "\(.*\)".*/\1/')
NAME=$(grep -m 1 '"name"' "$PACKAGE_JSON" | sed 's/.*"name": "\(.*\)".*/\1/')

info "\nProject Information:"
echo "  Name:        $NAME"
echo "  Version:     $VERSION"
echo "  Registry:    $REGISTRY"
echo "  Image Name:  $IMAGE_NAME"
echo "  Project Dir: $PROJECT_ROOT"
echo ""

# Construct image tags
VERSION_TAG="${REGISTRY}/${IMAGE_NAME}:${VERSION}"
LATEST_TAG="${REGISTRY}/${IMAGE_NAME}:latest"

# Check if we're in the correct directory structure
WARERA_BOT_PATH="$PROJECT_ROOT/WarEraBot"
WARERA_SDK_PATH="$PROJECT_ROOT/WarEraSDK"

if [ ! -d "$WARERA_BOT_PATH" ]; then
    error "Error: WarEraBot directory not found at $WARERA_BOT_PATH"
    warning "This script must be run from within the WarEraBot directory,"
    warning "and the parent directory must contain both WarEraBot and WarEraSDK."
    exit 1
fi

if [ ! -d "$WARERA_SDK_PATH" ]; then
    warning "Warning: WarEraSDK directory not found at $WARERA_SDK_PATH"
    warning "The Docker build may fail if it requires the SDK."
fi

# Build the Docker image
info "Step 1: Building Docker image..."
echo "  Building from: $PROJECT_ROOT"
echo "  Dockerfile:    WarEraBot/Dockerfile"
echo "  Tag:           $VERSION_TAG"
echo ""

cd "$PROJECT_ROOT"

if ! docker build -f WarEraBot/Dockerfile -t "$VERSION_TAG" .; then
    error "✗ Docker build failed"
    exit 1
fi

success "✓ Docker image built successfully: $VERSION_TAG"

# Tag with 'latest' if requested
if [ "$PUSH_LATEST" = true ]; then
    info "\nStep 2: Tagging image as 'latest'..."
    if ! docker tag "$VERSION_TAG" "$LATEST_TAG"; then
        error "✗ Docker tag failed"
        exit 1
    fi
    success "✓ Tagged as: $LATEST_TAG"
fi

# Push to registry if not skipped
if [ "$SKIP_PUSH" = false ]; then
    info "\nStep 3: Pushing to registry..."
    
    # Push version tag
    echo "  Pushing $VERSION_TAG..."
    if ! docker push "$VERSION_TAG"; then
        error "✗ Docker push failed"
        exit 1
    fi
    success "✓ Pushed: $VERSION_TAG"
    
    # Push latest tag if requested
    if [ "$PUSH_LATEST" = true ]; then
        echo "  Pushing $LATEST_TAG..."
        if ! docker push "$LATEST_TAG"; then
            error "✗ Docker push failed"
            exit 1
        fi
        success "✓ Pushed: $LATEST_TAG"
    fi
    
    success "\n✓ All images pushed successfully!"
else
    info "\nSkipping push (--skip-push specified)"
fi

success "\n========================================"
success "Build completed successfully!"
success "========================================"
echo -e "\nImage Tags:"
echo "  - $VERSION_TAG"
if [ "$PUSH_LATEST" = true ]; then
    echo "  - $LATEST_TAG"
fi
echo ""

if [ "$SKIP_PUSH" = false ]; then
    info "To pull and run this image:"
    echo "  docker pull $VERSION_TAG"
    echo "  docker run --env-file .env $VERSION_TAG"
fi
