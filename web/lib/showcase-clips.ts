/**
 * Fixed landing showcase clips in GCS (not DB Film rows).
 *
 * Objects: gs://{bucket}/marketing/showcase/
 * Upload: ./scripts/upload-showcase.sh ./path/to/clips
 * Playback: GET /api/showcase mints short-lived signed URLs (bucket stays private;
 * org policy blocks public allUsers bindings).
 */

export const SHOWCASE_BUCKET = "marryo-101026-marryo";
export const SHOWCASE_PREFIX = "marketing/showcase";

export type ShowcaseClipMeta = {
  film_id: string;
  title: string | null;
  couple_label: string | null;
  track_title: string | null;
  orientation: "portrait" | "landscape";
  /** Object name under SHOWCASE_PREFIX (e.g. portrait-01.mp4) */
  object: string;
  /** Optional poster object name */
  poster?: string;
};

export type ShowcaseClip = ShowcaseClipMeta & {
  playback_url: string;
  thumbnail_url?: string;
};

/** Exactly 4 portrait + 3 landscape for the landing gallery. */
export const SHOWCASE_CLIPS: ShowcaseClipMeta[] = [
  {
    film_id: "showcase_portrait_01",
    title: "Portrait short film",
    couple_label: null,
    track_title: "Portrait cut 1",
    orientation: "portrait",
    object: "portrait-01.mp4",
    poster: "portrait-01.jpg",
  },
  {
    film_id: "showcase_portrait_02",
    title: "Portrait short film",
    couple_label: null,
    track_title: "Portrait cut 2",
    orientation: "portrait",
    object: "portrait-02.mp4",
    poster: "portrait-02.jpg",
  },
  {
    film_id: "showcase_portrait_03",
    title: "Portrait short film",
    couple_label: null,
    track_title: "Portrait cut 3",
    orientation: "portrait",
    object: "portrait-03.mp4",
    poster: "portrait-03.jpg",
  },
  {
    film_id: "showcase_portrait_04",
    title: "Portrait short film",
    couple_label: null,
    track_title: "Portrait cut 4",
    orientation: "portrait",
    object: "portrait-04.mp4",
    poster: "portrait-04.jpg",
  },
  {
    film_id: "showcase_landscape_01",
    title: "Landscape short film",
    couple_label: null,
    track_title: "Landscape cut 1",
    orientation: "landscape",
    object: "landscape-01.mp4",
    poster: "landscape-01.jpg",
  },
  {
    film_id: "showcase_landscape_02",
    title: "Landscape short film",
    couple_label: null,
    track_title: "Landscape cut 2",
    orientation: "landscape",
    object: "landscape-02.mp4",
    poster: "landscape-02.jpg",
  },
  {
    film_id: "showcase_landscape_03",
    title: "Landscape short film",
    couple_label: null,
    track_title: "Landscape cut 3",
    orientation: "landscape",
    object: "landscape-03.mp4",
    poster: "landscape-03.jpg",
  },
];

export function showcaseGsUri(objectName: string): string {
  return `gs://${SHOWCASE_BUCKET}/${SHOWCASE_PREFIX}/${objectName}`;
}
