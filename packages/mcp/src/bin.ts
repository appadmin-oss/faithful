#!/usr/bin/env node
/**
 * `faithful-mcp`: the server over stdio, rooted at the directory it is started in. Configure a
 * client with `npx -y @usefaithful/mcp` and run it from the project root.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './index.js';

serveStdio(() => createServer(process.cwd()));
