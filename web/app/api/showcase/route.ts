import { storageService } from "@marryo/services/storage-service";

import {
  SHOWCASE_CLIPS,
  showcaseGsUri,
  type ShowcaseClip,
} from "@/lib/showcase-clips";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGN_TTL_SECONDS = 3600;

/**
 * Landing showcase clips from fixed GCS objects (not Film DB / visibility=public).
 */
export async function GET() {
  try {
    const storage = storageService();
    const films: ShowcaseClip[] = await Promise.all(
      SHOWCASE_CLIPS.map(async (meta) => {
        const playback_url = await storage.getSignedUrl(
          showcaseGsUri(meta.object),
          SIGN_TTL_SECONDS,
        );
        let thumbnail_url: string | undefined;
        if (meta.poster) {
          try {
            const posterUri = showcaseGsUri(meta.poster);
            if (await storage.objectExists(posterUri)) {
              thumbnail_url = await storage.getSignedUrl(posterUri, SIGN_TTL_SECONDS);
            }
          } catch {
            /* poster optional */
          }
        }
        return {
          ...meta,
          playback_url,
          thumbnail_url,
        };
      }),
    );
    return Response.json({ films });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
