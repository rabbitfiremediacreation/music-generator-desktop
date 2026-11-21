#!/usr/bin/env bash
set -euo pipefail

curl --fail --location --retry 3 https://sdk.lunarg.com/sdk/download/1.4.309.0/linux/vulkansdk-linux-x86_64-1.4.309.0.tar.xz -o "$RUNNER_TEMP/vulkan.tar.xz"
echo "616a25a9d8b33336e83957f97ca273b8e95461649723354300d02c26ae52a1f6  $RUNNER_TEMP/vulkan.tar.xz" | sha256sum --check
mkdir -p "$RUNNER_TEMP/vulkan"
tar -xf "$RUNNER_TEMP/vulkan.tar.xz" -C "$RUNNER_TEMP/vulkan" 1.4.309.0/x86_64
echo "VULKAN_SDK=$RUNNER_TEMP/vulkan/1.4.309.0/x86_64" >> "$GITHUB_ENV"
echo "$RUNNER_TEMP/vulkan/1.4.309.0/x86_64/bin" >> "$GITHUB_PATH"
