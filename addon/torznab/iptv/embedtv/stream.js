import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function streamToResponse(response, destination) {
  if (!response?.body) {
    destination.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), destination);
}
