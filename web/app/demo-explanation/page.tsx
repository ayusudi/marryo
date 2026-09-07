import { redirect } from "next/navigation";

/** Prefer homepage info panel — kept as a short alias. */
export default function DemoExplanationRedirect() {
  redirect("/#pipeline");
}
