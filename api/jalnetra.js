import { BlobPreconditionFailedError, get, put } from '@vercel/blob';
import { createHostedHandler, SnapshotConflict } from '../src/hosted.js';

const store = {
  async read(path) {
    const result = await get(path, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream || !result.blob.etag) throw new Error('Invalid private snapshot.');
    return { bytes: Buffer.from(await new Response(result.stream).arrayBuffer()), etag: result.blob.etag };
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

export default { fetch: createHostedHandler(store) };
