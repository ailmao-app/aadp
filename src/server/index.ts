/**
 * Declarative AADP v1.0 server runtime.
 *
 * ```ts
 * import { defineAADP, defineResource } from "ail-aadp/server";
 *
 * const aadp = defineAADP({
 *   baseUrl: "https://example.com",
 *   application: { name: "Example", description: "...", publisher: { name: "Example", url: "https://example.com" } },
 *   policies: { robots: "https://example.com/robots.txt", terms: "https://example.com/terms" },
 *   resources: [
 *     defineResource<Post>({
 *       type: "post",
 *       list: ({ cursor, limit }) => postRepository.listPublic({ cursor, limit }),
 *       get: ({ id }) => postRepository.findPublicBySlug(id),
 *       serialize: (post) => ({
 *         id: `post:${post.slug}`,
 *         updatedAt: post.updatedAt,
 *         canonicalUrl: `/posts/${post.slug}`,
 *         data: { title: post.title, summary: post.summary },
 *       }),
 *     }),
 *   ],
 * });
 *
 * // Next.js App Router route handler — `handleRequest` is a plain
 * // `(Request) => Promise<Response>`, so no framework adapter is needed:
 * export const GET = aadp.handleRequest;
 * ```
 */
export { defineAADP, defineResource } from "./runtime.js";
export { AadpServerError, type AadpServerErrorCode } from "./errors.js";
export {
  notFound,
  invalidRequest,
  unsupportedType,
  upstreamUnavailable,
  rateLimited,
} from "./errors.js";
export type {
  AadpServer,
  AadpServerConfig,
  GetArgs,
  ListArgs,
  ListResult,
  ResourceConfig,
  ResourceDefinition,
  SerializedEntity,
} from "./types.js";
