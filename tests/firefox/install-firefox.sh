#!/usr/bin/env bash
# Downloads a pinned Firefox release for the local Firefox smoke tests.
#
# Files go to ~/.cache/weekrow-test (or $WEEKROW_TEST_CACHE).
# Firefox 159.0 stays in firefox/ and other versions use firefox-VERSION/.
# Linux x86_64 and aarch64 only. Firefox also needs the usual desktop libraries.
set -euo pipefail

FIREFOX_VERSION="${1:-${WEEKROW_FIREFOX:-159.0}}"
GECKODRIVER_VERSION=0.37.1

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    FIREFOX_PLATFORM=linux-x86_64
    FIREFOX_159_SHA256=54536fcd120af484d4c56272a5a1cf4af57b9c713d1a3b1e775da192dd541fcd
    FIREFOX_140_SHA256=ca3469774734743b878bca2cfb7efb7b8a8eb4a3c15c2f1f427fbc0472ad3f6e
    GECKODRIVER_PLATFORM=linux64
    GECKODRIVER_SHA256=e815130ea95983e162ae91843b48d3a3ce991735635fce83a647afde21e09f7e
    ;;
  Linux-aarch64)
    FIREFOX_PLATFORM=linux-aarch64
    FIREFOX_159_SHA256=de7b16588bf3ab11774f6c1b1461dafde943c1cf0ea93dc15aa5f7bd99aa1191
    FIREFOX_140_SHA256=ee6fadf005a4a833debe5dabf13efbc43498270a584219fa0594f03c3f590007
    GECKODRIVER_PLATFORM=linux-aarch64
    GECKODRIVER_SHA256=8fd90b951422fbad5b56539fb344dff66eb3f986d615d8d6fde9f1f62dad610c
    ;;
  *)
    echo "This script supports Linux x86_64 and aarch64 only." >&2
    echo "Elsewhere, install Firefox yourself and set FIREFOX_BIN." >&2
    exit 1
    ;;
esac

case "$FIREFOX_VERSION" in
  159.0) FIREFOX_SHA256="$FIREFOX_159_SHA256" ;;
  140.0) FIREFOX_SHA256="$FIREFOX_140_SHA256" ;;
  *)
    echo "Unsupported Firefox version: $FIREFOX_VERSION (supported: 159.0, 140.0)." >&2
    exit 1
    ;;
esac

CACHE_DIR="${WEEKROW_TEST_CACHE:-$HOME/.cache/weekrow-test}"
FIREFOX_DIR="$CACHE_DIR/firefox-$FIREFOX_VERSION"
if [[ "$FIREFOX_VERSION" == 159.0 ]]; then
  FIREFOX_DIR="$CACHE_DIR/firefox"
fi
FIREFOX_URL="https://ftp.mozilla.org/pub/firefox/releases/${FIREFOX_VERSION}/${FIREFOX_PLATFORM}/en-US/firefox-${FIREFOX_VERSION}.tar.xz"
GECKODRIVER_URL="https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-${GECKODRIVER_PLATFORM}.tar.gz"
VERSION_FILE="$FIREFOX_DIR/.weekrow-version"
WANTED_VERSION="firefox=${FIREFOX_VERSION} platform=${FIREFOX_PLATFORM}"

if [[ -x "$FIREFOX_DIR/firefox" && -f "$VERSION_FILE" && "$(cat "$VERSION_FILE")" == "$WANTED_VERSION" ]]; then
  echo "Firefox ${FIREFOX_VERSION} is already installed in $FIREFOX_DIR."
  echo "FIREFOX_BIN=$FIREFOX_DIR/firefox"
  exit 0
fi
if [[ "$FIREFOX_VERSION" == 159.0 && -x "$FIREFOX_DIR/firefox" && -f "$CACHE_DIR/versions.txt" && "$(cat "$CACHE_DIR/versions.txt")" == "firefox=159.0 geckodriver=${GECKODRIVER_VERSION} platform=${FIREFOX_PLATFORM}" ]]; then
  echo "Firefox ${FIREFOX_VERSION} is already installed in $FIREFOX_DIR."
  echo "FIREFOX_BIN=$FIREFOX_DIR/firefox"
  exit 0
fi

mkdir -p "$CACHE_DIR"
WORK_DIR="$(mktemp -d "$CACHE_DIR/download.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

# download <url> <sha256> <file>
download() {
  echo "Downloading $1"
  curl --fail --location --silent --show-error --output "$3" "$1"
  echo "$2  $3" | sha256sum --check --quiet -
}

download "$FIREFOX_URL" "$FIREFOX_SHA256" "$WORK_DIR/firefox.tar.xz"
if [[ "$FIREFOX_VERSION" == 159.0 && ! -x "$CACHE_DIR/geckodriver" ]]; then
  download "$GECKODRIVER_URL" "$GECKODRIVER_SHA256" "$WORK_DIR/geckodriver.tar.gz"
fi

mkdir "$WORK_DIR/firefox-unpacked"
tar -xJf "$WORK_DIR/firefox.tar.xz" -C "$WORK_DIR/firefox-unpacked"
if [[ -f "$WORK_DIR/geckodriver.tar.gz" ]]; then
  mkdir "$WORK_DIR/geckodriver-unpacked"
  tar -xzf "$WORK_DIR/geckodriver.tar.gz" -C "$WORK_DIR/geckodriver-unpacked"
fi

rm -rf "$FIREFOX_DIR"
mv "$WORK_DIR/firefox-unpacked/firefox" "$FIREFOX_DIR"
if [[ -d "$WORK_DIR/geckodriver-unpacked" ]]; then
  mv "$WORK_DIR/geckodriver-unpacked/geckodriver" "$CACHE_DIR/geckodriver"
  chmod +x "$CACHE_DIR/geckodriver"
fi
echo "$WANTED_VERSION" > "$VERSION_FILE"

echo "Installed Firefox ${FIREFOX_VERSION} in $FIREFOX_DIR."
echo "FIREFOX_BIN=$FIREFOX_DIR/firefox"
