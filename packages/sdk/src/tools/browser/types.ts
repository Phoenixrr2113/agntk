import { z } from 'zod';

const selectorDesc = 'Element selector: ref (@e1), CSS (.class), or text ("Submit")';

const openSchema = z.object({
  action: z.literal('open'),
  url: z.string().describe('URL to navigate to'),
});

const snapshotSchema = z.object({
  action: z.literal('snapshot'),
  interactive: z.boolean().optional().describe('Only show interactive elements (-i flag)'),
});

const clickSchema = z.object({
  action: z.literal('click'),
  selector: z.string().describe(selectorDesc),
});

const dblclickSchema = z.object({
  action: z.literal('dblclick'),
  selector: z.string().describe(selectorDesc),
});

const fillSchema = z.object({
  action: z.literal('fill'),
  selector: z.string().describe(selectorDesc),
  text: z.string().describe('Text to fill into the element'),
});

const typeSchema = z.object({
  action: z.literal('type'),
  selector: z.string().describe(selectorDesc),
  text: z.string().describe('Text to type into the element'),
});

const selectSchema = z.object({
  action: z.literal('select'),
  selector: z.string().describe(selectorDesc),
  value: z.string().describe('Option value to select'),
});

const pressSchema = z.object({
  action: z.literal('press'),
  key: z.string().describe('Key to press (Enter, Tab, Control+a, etc.)'),
});

const hoverSchema = z.object({
  action: z.literal('hover'),
  selector: z.string().describe(selectorDesc),
});

const scrollSchema = z.object({
  action: z.literal('scroll'),
  direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
  pixels: z.number().optional().describe('Pixels to scroll (default: viewport)'),
});

const screenshotSchema = z.object({
  action: z.literal('screenshot'),
  path: z.string().optional().describe('File path for screenshot (default: auto-generated)'),
  fullPage: z.boolean().optional().describe('Capture full page instead of viewport'),
});

const getTextSchema = z.object({
  action: z.literal('getText'),
  selector: z.string().describe(selectorDesc),
});

const getUrlSchema = z.object({
  action: z.literal('getUrl'),
});

const getTitleSchema = z.object({
  action: z.literal('getTitle'),
});

const waitSchema = z.object({
  action: z.literal('wait'),
  selector: z.string().optional().describe('Wait for element to appear'),
  ms: z.number().optional().describe('Wait for milliseconds'),
  text: z.string().optional().describe('Wait for text to appear on page'),
  url: z.string().optional().describe('Wait for URL pattern'),
  load: z
    .enum(['load', 'domcontentloaded', 'networkidle'])
    .optional()
    .describe('Wait for page load state'),
});

const evalSchema = z.object({
  action: z.literal('eval'),
  js: z.string().describe('JavaScript code to evaluate in the page'),
});

const checkSchema = z.object({
  action: z.literal('check'),
  selector: z.string().describe(selectorDesc),
});

const uncheckSchema = z.object({
  action: z.literal('uncheck'),
  selector: z.string().describe(selectorDesc),
});

const closeSchema = z.object({
  action: z.literal('close'),
});

export const browserInputSchema = z.discriminatedUnion('action', [
  openSchema,
  snapshotSchema,
  clickSchema,
  dblclickSchema,
  fillSchema,
  typeSchema,
  selectSchema,
  pressSchema,
  hoverSchema,
  scrollSchema,
  screenshotSchema,
  getTextSchema,
  getUrlSchema,
  getTitleSchema,
  waitSchema,
  evalSchema,
  checkSchema,
  uncheckSchema,
  closeSchema,
]);

export type BrowserInput = z.infer<typeof browserInputSchema>;

export type BrowserAction = BrowserInput['action'];

export interface BrowserResult {
  output: string;
  exitCode: number;
  action: BrowserAction;
  durationMs: number;
}

export interface BrowserConfig {
  timeout?: number;

  session?: string;

  cdpUrl?: string;

  headless?: boolean;
}

export const BROWSER_ACTIONS = [
  'open',
  'snapshot',
  'click',
  'dblclick',
  'fill',
  'type',
  'select',
  'press',
  'hover',
  'scroll',
  'screenshot',
  'getText',
  'getUrl',
  'getTitle',
  'wait',
  'eval',
  'check',
  'uncheck',
  'close',
] as const;

export const BROWSER_TOOL_DESCRIPTION = `Browse the web, interact with pages, and extract content using the agent-browser CLI.

Available actions:
- open: Navigate to a URL
- snapshot: Get page accessibility tree with element refs (@e1, @e2...)
- click/dblclick: Click elements by ref or selector
- fill: Clear and fill input fields
- type: Type text into elements
- select: Choose dropdown options
- press: Press keyboard keys
- hover: Hover over elements
- scroll: Scroll the page
- screenshot: Capture page screenshot
- getText: Extract text content from elements
- getUrl/getTitle: Get current page URL or title
- wait: Wait for elements, text, URL patterns, or time
- eval: Run JavaScript in the page
- check/uncheck: Toggle checkboxes
- close: Close the browser

Workflow: open URL → snapshot to see refs → interact using refs → close.`;
