import { Readable } from 'node:stream';

export function streamToResponse(response, destination) {
  if (!response?.body) {
    destination.end();
    return;
  }
  const source = Readable.fromWeb(response.body);
  source.once('error', error => {
    if (!destination.destroyed) destination.destroy(error);
  });
  destination.once('close', () => {
    if (!destination.writableFinished) source.destroy();
  });
  source.pipe(destination);
}
