import type { ComponentProps } from "react";

import { isGoogleAuthConfigured } from "@/auth";
import { BeginFilmButton, SignInPrompt } from "@/components/begin-film";

export function BeginFilmCta(props: Omit<ComponentProps<typeof BeginFilmButton>, "googleConfigured">) {
  return <BeginFilmButton {...props} googleConfigured={isGoogleAuthConfigured()} />;
}

export function SignInPromptGate() {
  return <SignInPrompt googleConfigured={isGoogleAuthConfigured()} />;
}
