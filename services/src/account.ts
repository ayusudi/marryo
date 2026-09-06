import { prisma } from "./db";

export class AccountError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountError";
    this.status = status;
  }
}

export type AccountSettings = {
  user_id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  joined_at: string;
  first_video_at: string | null;
};

export async function ensureUser(input: {
  user_id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}): Promise<void> {
  const userId = input.user_id.trim();
  if (!userId) return;

  const db = prisma();
  const existing = await db.user.findUnique({ where: { userId } });
  if (existing) {
    await db.user.update({
      where: { userId },
      data: {
        name: input.name ?? existing.name,
        email: input.email ?? existing.email,
        image: input.image ?? existing.image,
      },
    });
    return;
  }

  await db.user.create({
    data: {
      userId,
      name: input.name ?? null,
      email: input.email ?? null,
      image: input.image ?? null,
    },
  });
}

export async function getAccountSettings(userId: string): Promise<AccountSettings> {
  const id = userId.trim();
  if (!id) throw new AccountError("sign in required", 401);

  const db = prisma();
  const user = await db.user.findUnique({ where: { userId: id } });
  if (!user) throw new AccountError("account not found", 404);

  const firstFilm = await db.film.findFirst({
    where: { project: { ownerId: id } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  return {
    user_id: user.userId,
    name: user.name,
    email: user.email,
    image: user.image,
    joined_at: user.createdAt.toISOString(),
    first_video_at: firstFilm?.createdAt.toISOString() ?? null,
  };
}

/** Deletes the user row and every project they own (cascades clips, films, etc.). */
export async function deleteAccount(userId: string): Promise<void> {
  const id = userId.trim();
  if (!id) throw new AccountError("sign in required", 401);

  const db = prisma();
  await db.project.deleteMany({ where: { ownerId: id } });
  await db.user.deleteMany({ where: { userId: id } });
}
