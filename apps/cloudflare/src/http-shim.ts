/**
 * Slice 09c: the Durable Object's Fetch-to-node-HTTP adapter. The implementation lives in the shared platform
 * package (it compiles under the Node-Types program as well, which the Node-side multipart tests and the root
 * compiler gate rely on); this module is the single import site the Durable Object wiring (10b) uses.
 */
export {
  toHttpRequestLike,
  createHttpResponseLike,
  type HttpResponseStream,
  clientAddressFromCloudflare,
  clientAddressFromCloudflareHeaderValue,
} from "../../../packages/platform-core/src/http-fetch-shim.js";
