import type { ServerContext } from "../server-context.js";

/**
 * Genre listing route — returns available genres with their language profiles.
 */
export function registerGenresRoutes(ctx: ServerContext): void {
  ctx.app.get("/api/v1/genres", async (c) => {
    const { listAvailableGenres, readGenreProfile } = await import("@actalk/inkos-core");
    const rawGenres = await listAvailableGenres(ctx.root);
    const genres = await Promise.all(
      rawGenres.map(async (g) => {
        try {
          const { profile } = await readGenreProfile(ctx.root, g.id);
          return { ...g, language: profile.language ?? "zh" };
        } catch {
          return { ...g, language: "zh" };
        }
      }),
    );
    return c.json({ genres });
  });
}
