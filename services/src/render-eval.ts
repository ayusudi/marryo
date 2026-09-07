/**
 * Post-render evaluation: compare the finished MP4 against the EDL contract.
 */

import { ffprobeMedia } from "./tech-validation.ts";

export type EdlForEval = {
  target_duration: number;
  scenes: Array<{
    name: string;
    clips?: Array<{ moment_id: string; start: number; end: number }>;
    text?: string | null;
    duration?: number | null;
  }>;
};

export type EvalCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type RenderEvaluation = {
  passed: boolean;
  checks: EvalCheck[];
  metrics: {
    duration: number;
    width: number;
    height: number;
    codec: string;
    audio_codec: string | null;
    expected_duration: number;
    scene_count_expected: number;
    scene_count_rendered: number;
  };
};

function sceneDuration(scene: EdlForEval["scenes"][number]): number {
  if (typeof scene.duration === "number" && scene.duration > 0) {
    return scene.duration;
  }
  const clips = scene.clips ?? [];
  return clips.reduce((sum, c) => sum + Math.max(0, c.end - c.start), 0);
}

function isRenderableScene(scene: EdlForEval["scenes"][number]): boolean {
  const hasClips = (scene.clips ?? []).length > 0;
  const hasCard = Boolean(scene.text && scene.duration && scene.duration > 0);
  return hasClips || hasCard;
}

export async function evaluateRender(input: {
  outputPath: string;
  edl: EdlForEval;
  maxDuration: number;
  width: number;
  height: number;
  sceneCountRendered: number;
  transitionDuration?: number;
  typography?: {
    title?: {
      contrast_ratio?: number;
      animation_id?: string;
      animation_duration_s?: number;
      position_id?: string;
      font_family_id?: string;
    };
    ending?: {
      contrast_ratio?: number;
      animation_id?: string;
      animation_duration_s?: number;
      position_id?: string;
      font_family_id?: string;
    };
    title_duration?: number;
    ending_duration?: number;
    orientation?: string;
  };
}): Promise<RenderEvaluation> {
  const checks: EvalCheck[] = [];
  const renderable = input.edl.scenes.filter(isRenderableScene);
  const expectedDuration = renderable.reduce((sum, s) => sum + sceneDuration(s), 0);
  // xfade shortens total duration by transitionDuration * (n-1)
  const xfadeShrink =
    Math.max(0, renderable.length - 1) * (input.transitionDuration ?? 0.5);
  const expectedAfterXfade = Math.max(0.1, expectedDuration - xfadeShrink);

  let metrics: RenderEvaluation["metrics"] = {
    duration: 0,
    width: 0,
    height: 0,
    codec: "",
    audio_codec: null,
    expected_duration: expectedAfterXfade,
    scene_count_expected: renderable.length,
    scene_count_rendered: input.sceneCountRendered,
  };

  try {
    const probe = await ffprobeMedia(input.outputPath);
    metrics = {
      ...metrics,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      codec: probe.codec,
      audio_codec: probe.audioCodec,
    };

    checks.push({
      name: "playable",
      passed: true,
      detail: `ffprobe ok duration=${probe.duration.toFixed(2)}s`,
    });

    const durationDelta = Math.abs(probe.duration - expectedAfterXfade);
    checks.push({
      name: "duration_matches_edl",
      passed: durationDelta <= 1.5,
      detail: `actual=${probe.duration.toFixed(2)}s expected≈${expectedAfterXfade.toFixed(2)}s delta=${durationDelta.toFixed(2)}s`,
    });

    checks.push({
      name: "within_max_duration",
      // Match duration_matches_edl slack — a sub-second overrun (e.g. 30.9 vs 30) is fine.
      passed: probe.duration <= input.maxDuration + 1.5,
      detail: `actual=${probe.duration.toFixed(2)}s max=${input.maxDuration}s`,
    });

    checks.push({
      name: "resolution",
      passed: probe.width === input.width && probe.height === input.height,
      detail: `actual=${probe.width}x${probe.height} expected=${input.width}x${input.height}`,
    });

    const codecOk = probe.codec === "h264" || probe.codec === "avc1";
    checks.push({
      name: "codec",
      passed: codecOk,
      detail: `codec=${probe.codec}`,
    });

    checks.push({
      name: "has_audio_track",
      passed: probe.hasAudio,
      detail: probe.hasAudio ? `audio_codec=${probe.audioCodec}` : "no audio stream",
    });
  } catch (error) {
    checks.push({
      name: "playable",
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  checks.push({
    name: "all_scenes_present",
    passed: input.sceneCountRendered === renderable.length,
    detail: `rendered=${input.sceneCountRendered} expected=${renderable.length}`,
  });

  const typo = input.typography;
  if (typo) {
    const cards = [typo.title, typo.ending].filter(Boolean) as Array<{
      contrast_ratio?: number;
      animation_id?: string;
      animation_duration_s?: number;
      position_id?: string;
      font_family_id?: string;
    }>;
    const minContrast = Math.min(
      ...cards.map((c) => Number(c.contrast_ratio ?? 99)),
      99,
    );
    checks.push({
      name: "typography_contrast",
      passed: minContrast >= 4.5,
      detail: `min_contrast_ratio=${minContrast === 99 ? "n/a" : minContrast.toFixed(2)}`,
    });

    const titleAnimOk =
      !typo.title ||
      !typo.title.animation_id ||
      typo.title.animation_id === "none" ||
      Number(typo.title.animation_duration_s ?? 0) <=
        Number(typo.title_duration ?? 2) - 0.15;
    const endingAnimOk =
      !typo.ending ||
      !typo.ending.animation_id ||
      typo.ending.animation_id === "none" ||
      Number(typo.ending.animation_duration_s ?? 0) <=
        Number(typo.ending_duration ?? 3) - 0.15;
    checks.push({
      name: "typography_animation_fits_card",
      passed: Boolean(titleAnimOk && endingAnimOk),
      detail: `title_anim=${typo.title?.animation_id ?? "n/a"} ending_anim=${typo.ending?.animation_id ?? "n/a"}`,
    });

    if (typo.orientation === "portrait") {
      const positions = [typo.title?.position_id, typo.ending?.position_id].filter(Boolean);
      const bad = positions.filter((p) => p === "lower_third");
      checks.push({
        name: "typography_portrait_layout",
        passed: bad.length === 0,
        detail:
          bad.length === 0
            ? `positions=${positions.join(",")}`
            : `lower_third used on portrait: ${bad.join(",")}`,
      });
    }

    const families = [typo.title?.font_family_id, typo.ending?.font_family_id].filter(Boolean);
    checks.push({
      name: "typography_decision_present",
      passed: families.length > 0,
      detail: `families=${families.join(",") || "none"}`,
    });
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
    metrics,
  };
}

export function expectedEdlDuration(edl: EdlForEval, transitionDuration = 0.5): number {
  const renderable = edl.scenes.filter(isRenderableScene);
  const raw = renderable.reduce((sum, s) => sum + sceneDuration(s), 0);
  const shrink = Math.max(0, renderable.length - 1) * transitionDuration;
  return Math.max(0.1, raw - shrink);
}
