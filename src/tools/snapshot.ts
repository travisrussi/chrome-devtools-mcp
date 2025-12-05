/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const takeSnapshot = defineTool({
  name: 'take_snapshot',
  description: `Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique
identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot. The snapshot indicates the element selected
in the DevTools Elements panel (if any).`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    // Not read-only due to filePath param.
    readOnlyHint: false,
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe(
        'Whether to include all possible information available in the full a11y tree. Default is false.',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute path, or a path relative to the current working directory, to save the snapshot to instead of attaching it to the response.',
      ),
  },
  handler: async (request, response) => {
    response.includeSnapshot({
      verbose: request.params.verbose ?? false,
      filePath: request.params.filePath,
    });
  },
});

export const waitFor = defineTool({
  name: 'wait_for',
  description: `Wait for the specified text to appear on the selected page.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    text: zod.string().describe('Text to appear on the page'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    await context.waitForTextOnPage(
      request.params.text,
      request.params.timeout,
    );

    response.appendResponseLine(
      `Element with text "${request.params.text}" found.`,
    );

    response.includeSnapshot();
  },
});

export const getVisibleHtml = defineTool({
  name: 'get_visible_html',
  description: `Get the HTML content of the currently selected page. By default, all <script> tags are removed from the output unless removeScripts is explicitly set to false.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    selector: zod
      .string()
      .optional()
      .describe('CSS selector to limit the HTML to a specific container'),
    removeScripts: zod
      .boolean()
      .optional()
      .describe('Remove all script tags from the HTML (default: true)'),
    removeComments: zod
      .boolean()
      .optional()
      .describe('Remove all HTML comments (default: false)'),
    removeStyles: zod
      .boolean()
      .optional()
      .describe('Remove all style tags from the HTML (default: false)'),
    removeMeta: zod
      .boolean()
      .optional()
      .describe('Remove all meta tags from the HTML (default: false)'),
    cleanHtml: zod
      .boolean()
      .optional()
      .describe('Perform comprehensive HTML cleaning (default: false)'),
    minify: zod
      .boolean()
      .optional()
      .describe('Minify the HTML output (default: false)'),
    maxLength: zod
      .number()
      .optional()
      .describe(
        'Maximum number of characters to return (default: 20000)',
      ),
  },
  handler: async (request, response, context) => {
    const page = context.getSelectedPage();
    let html: string;

    // Get HTML content based on selector or full page
    if (request.params.selector) {
      const element = await page.$(request.params.selector);
      if (!element) {
        throw new Error(`Element not found: ${request.params.selector}`);
      }
      const htmlHandle = await element.getProperty('innerHTML');
      html = (await htmlHandle.jsonValue()) as string;
    } else {
      html = await page.content();
    }

    // Apply HTML cleaning options (defaults match original implementation)
    const removeScripts = request.params.removeScripts !== false; // default: true
    const removeComments = request.params.removeComments === true; // default: false
    const removeStyles = request.params.removeStyles === true; // default: false
    const removeMeta = request.params.removeMeta === true; // default: false
    const cleanHtml = request.params.cleanHtml === true; // default: false
    const minify = request.params.minify === true; // default: false
    const maxLength = request.params.maxLength || 20000; // default: 20000

    if (removeScripts) {
      html = html.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        '',
      );
    }

    if (removeComments) {
      html = html.replace(/<!--[\s\S]*?-->/g, '');
    }

    if (removeStyles) {
      html = html.replace(
        /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
        '',
      );
    }

    if (removeMeta) {
      html = html.replace(/<meta\b[^>]*>/gi, '');
    }

    if (cleanHtml) {
      // Remove empty attributes and normalize whitespace
      html = html
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s*=\s*""/g, '')
        .trim();
    }

    if (minify) {
      // More aggressive minification
      html = html
        .replace(/\s{2,}/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s+>/g, '>')
        .replace(/<\s+/g, '<')
        .trim();
    }

    // Truncate if needed
    if (html.length > maxLength) {
      html = html.substring(0, maxLength) + '...';
    }

    // Save HTML to a file in the tmp directory
    const TMP_DIR = path.resolve(__dirname, '../../tmp');
    await mkdir(TMP_DIR, {recursive: true});

    const unique = `${Date.now()}-${randomBytes(6).toString('hex')}`;
    const filename = `chrome-devtools-html-${unique}.html`;
    const filePath = path.join(TMP_DIR, filename);

    await writeFile(filePath, html, 'utf8');

    // Dynamically import to get the actual HTTP server port
    const {httpServer} = await import('../main.js');
    const port = httpServer.port;
    const url = `http://localhost:${port}/tmp/${filename}`;

    response.appendResponseLine(`HTML saved to: ${url}`);
    response.appendResponseLine('');
    response.appendResponseLine(
      'You can download the HTML file by fetching the URL above.',
    );
  },
});
