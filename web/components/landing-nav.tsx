import { isGoogleAuthConfigured } from "@/auth";
import { AppNav } from "@/components/app-nav";

/** Landing header nav (dark). */
export function LandingNav() {
  return <AppNav variant="dark" googleConfigured={isGoogleAuthConfigured()} />;
}
