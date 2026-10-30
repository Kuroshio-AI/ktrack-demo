// The trial worker's bindings (wrangler.jsonc), and only the parts of Cloudflare's D1 API that KTrack calls.
interface D1Result<T = Record<string, unknown>> { results: T[]; meta: { changes: number } }
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}
interface R2ObjectBody { body: ReadableStream; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
}
interface CloudflareEnv { DB: D1Database; PHOTOS: R2Bucket }
