#!/usr/bin/env node
// Builds the Chrome extension with its test-only code into .output-e2e, as the browser tests do.
// The switch is set in Node, so the command runs the same on every platform.
import { build } from './lib/ensure-build.mjs';

build('chrome', 'e2e');
