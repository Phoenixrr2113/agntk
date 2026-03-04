/**
 * @fileoverview System context and prompt building utilities.
 * Handles gathering of environment information, user preferences, and workspace
 * structure to provide contextual information to the AI model.
 */
import { GEOLOCATION_API_URL, GEOLOCATION_ENABLED_DEFAULT } from '../constants';

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
}

export interface UserPreferences {
  name?: string;
  language?: string;
  communicationStyle?: 'concise' | 'detailed' | 'technical' | 'casual';
  codeStyle?: {
    indentation?: 'tabs' | 'spaces';
    indentSize?: number;
    quoteStyle?: 'single' | 'double';
  };
  customPreferences?: Record<string, unknown>;
}

export interface SystemContext {
  currentTime: string;
  currentDate: string;
  timezone: string;

  platform: string;
  hostname: string;
  username: string;
  locale: string;

  workspaceRoot?: string;
  workspaceMap?: string;

  userLocation?: UserLocation;
  userPreferences?: UserPreferences;
  userProfileBlock?: string;
}

export interface ContextOptions {
  workspaceRoot?: string;
  includeWorkspaceMap?: boolean;
  userLocation?: UserLocation;
  userPreferences?: UserPreferences;
  fetchLocation?: boolean;
}

const isNode = typeof process !== 'undefined' && process.versions?.node;

async function getNodeInfo(): Promise<{ platform: string; hostname: string; username: string }> {
  if (!isNode) {
    return {
      platform: 'browser',
      hostname: 'browser',
      username: 'user',
    };
  }

  const os = await import('node:os');
  return {
    platform: os.platform(),
    hostname: os.hostname(),
    username: os.userInfo().username,
  };
}

function getLocale(): string {
  if (typeof Intl !== 'undefined') {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  }
  return 'en-US';
}

async function fetchUserLocation(): Promise<UserLocation | undefined> {
  try {
    const response = await fetch(GEOLOCATION_API_URL);
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      city?: string;
      regionName?: string;
      country?: string;
      countryCode?: string;
      timezone?: string;
    };

    return {
      city: data.city,
      region: data.regionName,
      country: data.country,
      countryCode: data.countryCode,
      timezone: data.timezone,
    };
  } catch {
    return undefined;
  }
}

async function generateWorkspaceMap(workspaceRoot: string): Promise<string> {
  if (!isNode) return '';

  try {
    const fs = await import('node:fs');
    const path = await import('node:path');

    if (!fs.existsSync(workspaceRoot)) return '';

    const entries = fs.readdirSync(workspaceRoot);
    const topLevel = entries
      .filter((e) => !e.startsWith('.'))
      .slice(0, 20)
      .map((e) => {
        const fullPath = path.join(workspaceRoot, e);
        const isDir = fs.statSync(fullPath).isDirectory();
        if (isDir) {
          const children = fs
            .readdirSync(fullPath)
            .filter((c) => !c.startsWith('.'))
            .slice(0, 5);
          return `${e}/: ${children.join(', ')}${children.length >= 5 ? '...' : ''}`;
        }
        return e;
      });
    return topLevel.join('\n');
  } catch {
    return '';
  }
}

export async function buildSystemContext(options: ContextOptions = {}): Promise<SystemContext> {
  const {
    workspaceRoot,
    includeWorkspaceMap = false,
    userLocation,
    userPreferences,
    fetchLocation = GEOLOCATION_ENABLED_DEFAULT,
  } = options;

  const now = new Date();
  const nodeInfo = await getNodeInfo();

  let location = userLocation;
  if (!location && fetchLocation) {
    location = await fetchUserLocation();
  }

  const preferences = userPreferences;

  const context: SystemContext = {
    currentTime: now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
    currentDate: now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    timezone: location?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: nodeInfo.platform,
    hostname: nodeInfo.hostname,
    username: nodeInfo.username,
    locale: getLocale(),
    workspaceRoot,
    userLocation: location,
    userPreferences: preferences,
  };

  if (includeWorkspaceMap && workspaceRoot) {
    context.workspaceMap = await generateWorkspaceMap(workspaceRoot);
  }

  return context;
}

export function formatSystemContextBlock(context: SystemContext): string {
  const lines = [
    '# Current Environment',
    '',
    `- **Date**: ${context.currentDate}`,
    `- **Time**: ${context.currentTime} (${context.timezone})`,
    `- **Locale**: ${context.locale}`,
    `- **Platform**: ${context.platform}`,
    `- **User**: ${context.username}`,
  ];

  if (context.userLocation) {
    const loc = context.userLocation;
    const locationParts = [loc.city, loc.region, loc.country].filter(Boolean);
    if (locationParts.length > 0) {
      lines.push(`- **Location**: ${locationParts.join(', ')}`);
    }
  }

  if (context.workspaceRoot) {
    lines.push(`- **Workspace**: ${context.workspaceRoot}`);
  }

  if (context.workspaceMap) {
    lines.push('');
    lines.push('## Workspace Structure');
    lines.push('```');
    lines.push(context.workspaceMap);
    lines.push('```');
  }

  if (context.userPreferences) {
    const prefs = context.userPreferences;
    lines.push('');
    lines.push('## User Preferences');

    if (prefs.name) lines.push(`- **Name**: ${prefs.name}`);
    if (prefs.language) lines.push(`- **Preferred Language**: ${prefs.language}`);
    if (prefs.communicationStyle)
      lines.push(`- **Communication Style**: ${prefs.communicationStyle}`);

    if (prefs.codeStyle) {
      lines.push('- **Code Style**:');
      if (prefs.codeStyle.indentation)
        lines.push(`  - Indentation: ${prefs.codeStyle.indentation}`);
      if (prefs.codeStyle.indentSize) lines.push(`  - Indent Size: ${prefs.codeStyle.indentSize}`);
      if (prefs.codeStyle.quoteStyle) lines.push(`  - Quote Style: ${prefs.codeStyle.quoteStyle}`);
    }

    if (prefs.customPreferences && Object.keys(prefs.customPreferences).length > 0) {
      for (const [key, value] of Object.entries(prefs.customPreferences)) {
        lines.push(`- **${key}**: ${String(value)}`);
      }
    }
  }

  if (context.userProfileBlock) {
    lines.push('');
    lines.push(context.userProfileBlock);
  }

  return lines.join('\n');
}

export async function buildDynamicSystemPrompt(
  basePrompt: string,
  options: ContextOptions = {},
): Promise<string> {
  const context = await buildSystemContext(options);
  const contextBlock = formatSystemContextBlock(context);
  return `${basePrompt}\n\n${contextBlock}`;
}
