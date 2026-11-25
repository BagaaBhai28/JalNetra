import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from '@vercel/blob';
import { createHostedHandler, SnapshotConflict } from '../src/hosted.js';
import { createPilotHandler } from '../src/pilot.js';

const store = {
  async read(path, { forWrite }) {
    let revision;
    if (forWrite) {
      try {
        revision = (await head(path)).etag;
        if (!revision) throw new Error('Missing private snapshot revision.');
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    }
    const result = await get(path, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new Error('Invalid private snapshot.');
    return { bytes: Buffer.from(await new Response(result.stream).arrayBuffer()), etag: revision };
  },
  async write(path, bytes, etag) {
    try {
      await put(path, bytes, {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/octet-stream',
        ttlDays: 7,
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : {}),
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || (!etag && /already exists/i.test(error.message))) {
        throw new SnapshotConflict();
      }
      throw error;
    }
  },
};

const hosted = createHostedHandler(store);
const pilot = createPilotHandler({
  url: process.env.SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
});

export default {
  async fetch(request) {
    return (await pilot(request)) ?? hosted(request);
  },
};
