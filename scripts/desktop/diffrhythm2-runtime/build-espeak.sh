#!/bin/sh
set -eu

source_dir=$1
build_dir=$2
install_dir=$3

# The pinned upstream script fetches an optional dependency even when disabled.
# Exclude that fallback so eSpeak and its data build from the pinned source alone.
sed 's/^else()$/elseif(USE_LIBSONIC)/' "$source_dir/cmake/deps.cmake" > "$source_dir/cmake/deps.cmake.local"
mv "$source_dir/cmake/deps.cmake.local" "$source_dir/cmake/deps.cmake"

cmake -S "$source_dir" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_INSTALL_LIBDIR=lib \
  -DBUILD_SHARED_LIBS=ON -DBUILD_TESTING=OFF -DUSE_MBROLA=OFF -DUSE_LIBPCAUDIO=OFF \
  -DUSE_LIBSONIC=OFF -DUSE_SPEECHPLAYER=OFF
cmake --build "$build_dir" --parallel 2
DESTDIR="$install_dir" cmake --install "$build_dir"
