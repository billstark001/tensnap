#!/bin/bash
# Release helper script for Tensnap components

set -e

show_help() {
    echo "Usage: ./scripts/release.sh [component] [version]"
    echo ""
    echo "Components:"
    echo "  python    - Release Python package to PyPI"
    echo "  app       - Release Tauri desktop app"
    echo "  web       - Deploy web app (automatic on main)"
    echo ""
    echo "Example:"
    echo "  ./scripts/release.sh python 0.1.0"
    echo "  ./scripts/release.sh app 0.1.0"
}

if [ "$#" -lt 1 ]; then
    show_help
    exit 1
fi

COMPONENT=$1
VERSION=$2

case $COMPONENT in
    python)
        if [ -z "$VERSION" ]; then
            echo "Error: Version required for Python release"
            exit 1
        fi
        
        echo "Preparing Python package v$VERSION release..."
        
        # Update version in pyproject.toml
        sed -i.bak "s/^version = .*/version = \"$VERSION\"/" packages/tensnap-python/pyproject.toml
        rm packages/tensnap-python/pyproject.toml.bak
        
        git add packages/tensnap-python/pyproject.toml
        git commit -m "Release Python package v$VERSION"
        git tag "py-v$VERSION"
        
        echo "Created tag py-v$VERSION"
        echo "Push with: git push origin main && git push origin py-v$VERSION"
        ;;
        
    app)
        if [ -z "$VERSION" ]; then
            echo "Error: Version required for app release"
            exit 1
        fi
        
        echo "Preparing Tauri app v$VERSION release..."
        
        # Update version in package.json
        cd packages/tensnap-tauri
        npm version "$VERSION" --no-git-tag-version
        cd ../..
        
        # Update version in Cargo.toml
        sed -i.bak "s/^version = .*/version = \"$VERSION\"/" packages/tensnap-tauri/src-tauri/Cargo.toml
        rm packages/tensnap-tauri/src-tauri/Cargo.toml.bak
        
        git add packages/tensnap-tauri/package.json packages/tensnap-tauri/src-tauri/Cargo.toml
        git commit -m "Release Tauri app v$VERSION"
        git tag "app-v$VERSION"
        
        echo "Created tag app-v$VERSION"
        echo "Push with: git push origin main && git push origin app-v$VERSION"
        ;;
        
    web)
        echo "Web app deploys automatically on push to main"
        echo "Just commit and push your changes to main branch"
        ;;
        
    *)
        echo "Error: Unknown component '$COMPONENT'"
        show_help
        exit 1
        ;;
esac
