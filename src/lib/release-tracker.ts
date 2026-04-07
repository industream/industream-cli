// src/lib/release-tracker.ts
// Fetches latest versions from the Industream release-tracker repo

const VERSIONS_URL =
  "https://api.github.com/repos/industream/release-tracker/contents/versions.json";

export interface ReleaseTrackerComponent {
  name: string;
  image: string;
  version: string;
  publishedDate?: string;
  url?: string;
}

export interface ReleaseTrackerProject {
  name: string;
  key: string;
  components: ReleaseTrackerComponent[];
}

export interface ReleaseTrackerData {
  lastUpdated: string;
  registry: string;
  projects: ReleaseTrackerProject[];
}

let cachedVersions: Map<string, string> | null = null;

async function fetchReleaseTracker(): Promise<ReleaseTrackerData | null> {
  try {
    const response = await fetch(VERSIONS_URL, {
      headers: { Accept: "application/vnd.github.raw" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return (await response.json()) as ReleaseTrackerData;
  } catch {
    return null;
  }
}

/**
 * Returns a map of image name → latest version from the release tracker.
 * Returns null if the tracker cannot be reached (no internet).
 */
export async function getLatestVersions(): Promise<Map<string, string> | null> {
  if (cachedVersions) return cachedVersions;

  const data = await fetchReleaseTracker();
  if (!data) return null;

  const versions = new Map<string, string>();
  for (const project of data.projects) {
    for (const component of project.components) {
      versions.set(component.image, component.version);
    }
  }

  cachedVersions = versions;
  return versions;
}

/**
 * Check if a version string matches the latest available.
 */
export function isLatest(current: string, latest: string): boolean {
  if (!current || !latest) return false;
  // Strip common prefixes (v, release-)
  const normalize = (v: string): string =>
    v.replace(/^v/, "").replace(/^release-/, "").trim();
  return normalize(current) === normalize(latest);
}

/**
 * Reset the in-memory cache (useful for tests).
 */
export function resetCache(): void {
  cachedVersions = null;
}
