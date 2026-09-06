import { expect, test } from "@playwright/test";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loginE2E } from "./helpers/auth";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = (name: string) => path.join(root, "scripts", "sample-clips", name);

test.describe("API integration", () => {
  test("health is ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("public films list returns films array", async ({ request }) => {
    const res = await request.get("/api/films/public?limit=12");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.films)).toBe(true);
  });

  test("create project → upload sample clip → status validated", async ({ request }) => {
    await loginE2E(request);

    const created = await request.post("/api/projects", {
      data: {
        couple_names: [
          { name: "E2E Bride", role: "bride" },
          { name: "E2E Groom", role: "groom" },
        ],
        mood: "warm",
        orientation: "landscape",
        max_duration: 60,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const project = await created.json();
    expect(project.project_id).toMatch(/^prj_/);
    expect(project.owner_id).toBeTruthy();

    const listed = await request.get("/api/projects");
    expect(listed.status()).toBe(200);
    const listBody = await listed.json();
    expect(
      listBody.projects.some((p: { project_id: string }) => p.project_id === project.project_id),
    ).toBe(true);

    const buf = Buffer.from(await new Response(createReadStream(sample("good-1.mp4"))).arrayBuffer());

    const uploaded = await request.post(`/api/projects/${project.project_id}/upload`, {
      multipart: {
        files: {
          name: "good-1.mp4",
          mimeType: "video/mp4",
          buffer: buf,
        },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const uploadBody = await uploaded.json();
    expect(uploadBody.clips?.length).toBeGreaterThan(0);

    const statusRes = await request.get(`/api/projects/${project.project_id}/status`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();
    expect(status.current_stage).toBe("validated");
  });

  test("projects list requires auth", async ({ request }) => {
    const res = await request.get("/api/projects");
    expect(res.status()).toBe(401);
  });

  test("unknown project returns 404", async ({ request }) => {
    const res = await request.get("/api/projects/prj_does_not_exist");
    expect(res.status()).toBe(404);
  });
});
