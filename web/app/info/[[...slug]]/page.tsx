import { redirect } from "next/navigation";

const MAP: Record<string, string> = {
  about: "/#about",
  tutorial: "/#tutorial",
  terms: "/#terms",
  privacy: "/#privacy",
  pipeline: "/#pipeline",
  tech: "/#tech",
};

export default async function InfoCatchAll({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const key = slug?.[0] ?? "about";
  redirect(MAP[key] ?? "/#about");
}
