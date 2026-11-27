import { guardApiRequest } from "./rate-limit.ts";

interface Env {
  DB: D1Database;
  API_BEARER_TOKEN?: string;
}

/** Applies shared authentication and abuse quotas to all supported API routes. */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/(transactions|merchants|analysis\/(monthly|categories))\/?$/.test(path)) {
    return next();
  }
  const response = await guardApiRequest(request, env.DB, env.API_BEARER_TOKEN);
  return response ?? next();
};
