import { redirect } from "next/navigation";

/** New-project form lives on the dashboard. */
export default function NewStudioRedirect() {
  redirect("/studio#new");
}
