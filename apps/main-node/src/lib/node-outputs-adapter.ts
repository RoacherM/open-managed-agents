// Node OutputsAdapter — wraps a local outputs root (default
// `./data/session-outputs`) as the per-session outputs surface that
// `@open-managed-agents/http-routes`'s sessions package consumes.
// CF wires its R2-backed equivalent in apps/main; this is the
// Node-side companion.

import { createReadStream } from "node:fs";
import { stat as fsStat, readdir as fsReaddir, rm as fsRm } from "node:fs/promises";
import { join, resolve as resolvePath, sep } from "node:path";
import { Readable } from "node:stream";
import { guessSessionOutputMime } from "@open-managed-agents/shared";

export function nodeOutputsAdapter(outputsRoot: string) {
  return {
    // Walks subdirectories: the agent writes structured output trees
    // (shots/, storyboards/, …) and the console renders them as a tree, so
    // a top-level-only listing hid most of what a session produced. Paths
    // are returned relative to the session root with `/` separators, which
    // is the same shape the R2 adapter yields.
    async list(tenantId: string, sessionId: string) {
      const dir = resolvePath(outputsRoot, tenantId, sessionId);
      let entries: string[];
      try {
        entries = await fsReaddir(dir, { recursive: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const out: Array<{
        filename: string;
        size_bytes: number;
        uploaded_at: string;
        media_type: string;
      }> = [];
      for (const entry of entries) {
        try {
          const st = await fsStat(join(dir, entry));
          if (!st.isFile()) continue;
          const filename = entry.split(sep).join("/");
          out.push({
            filename,
            size_bytes: st.size,
            uploaded_at: new Date(st.mtimeMs).toISOString(),
            media_type: guessSessionOutputMime(filename),
          });
        } catch {
          /* skip unreadable entries */
        }
      }
      return out;
    },
    async read(tenantId: string, sessionId: string, filename: string) {
      const sessionDir = resolvePath(outputsRoot, tenantId, sessionId);
      const full = resolvePath(sessionDir, filename);
      // Defence in depth against traversal. The route already rejects `..`
      // and absolute paths, but this adapter is a public export and the
      // tenant/session prefix is the whole isolation boundary — a symlink
      // or an odd encoding must not be able to escape it.
      if (full !== sessionDir && !full.startsWith(sessionDir + sep)) return null;
      let st;
      try {
        st = await fsStat(full);
        if (!st.isFile()) return null;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      const nodeStream = createReadStream(full);
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
      return {
        body: webStream,
        size: st.size,
        contentType: guessSessionOutputMime(filename),
      };
    },
    async deleteAll(tenantId: string, sessionId: string) {
      const dir = resolvePath(outputsRoot, tenantId, sessionId);
      await fsRm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
