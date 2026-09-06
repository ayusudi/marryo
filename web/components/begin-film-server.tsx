import type { ComponentProps } from "react";

import { googleAuthConfigured } from "@/auth";
import { BeginFilmButton, SignInPrompt } from "@/components/begin-film";

export function BeginFilmCta(props: Omit<ComponentProps<typeof BeginFilmButton>, "googleConfigured">) {
  return <BeginFilmButton {...props} googleConfigured={googleAuthConfigured} />;
}

export function SignInPromptGate() {
  return <SignInPrompt googleConfigured={googleAuthConfigured} />;
}
