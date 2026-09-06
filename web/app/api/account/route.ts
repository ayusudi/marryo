import { auth } from "@/auth";
import { AccountError, deleteAccount, ensureUser, getAccountSettings } from "@marryo/services/account";

export const dynamic = "force-dynamic";

async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id?.trim();
  if (!userId || !session?.user) {
    return null;
  }
  await ensureUser({
    user_id: userId,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  });
  return session.user;
}

/** Account settings for the signed-in user. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!user?.id) {
      return Response.json({ error: "sign in required" }, { status: 401 });
    }
    const settings = await getAccountSettings(user.id);
    return Response.json(settings);
  } catch (error) {
    if (error instanceof AccountError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Permanently delete the account and all owned projects. */
export async function DELETE() {
  try {
    const user = await requireUser();
    if (!user?.id) {
      return Response.json({ error: "sign in required" }, { status: 401 });
    }
    await deleteAccount(user.id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AccountError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
