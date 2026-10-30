import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Prerendered pages are served from the deploy's own static files: nothing revalidates, so no R2 cache bucket is needed.
export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache });
