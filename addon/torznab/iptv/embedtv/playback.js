import { EmbedTvError } from './client.js';
import {
  getFirstMediaSegmentUrl,
  getFirstVariantUrl,
  isPlausibleMediaSegment,
} from './hls.js';
import { isHlsBody } from './resolver.js';

export async function probeHlsPlayback({ channel, resolveChannel, loadManifest, client } = {}) {
  const resolution = await resolveChannel(channel.id);
  const manifest = await loadFirstMediaPlaylist(client, resolution, loadManifest);
  const segmentUrl = getFirstMediaSegmentUrl(manifest.text, manifest.url);
  if (!segmentUrl || /\.(?:m3u8|txt)(?:$|\?)/i.test(segmentUrl)) {
    throw new EmbedTvError('O manifesto não contém um primeiro segmento de mídia', {
      statusCode: 502,
      code: 'missing_media_segment',
      url: manifest.url,
      stage: 'playback-segment',
    });
  }

  const response = await client.fetchStream(segmentUrl, {
    retry: false,
    stage: 'playback-segment',
    headers: { ...resolution.headers, Range: 'bytes=0-383' },
  });
  if (!response.ok) {
    throw new EmbedTvError(`Primeiro segmento respondeu HTTP ${response.status}`, {
      statusCode: response.status,
      code: `segment_${response.status}`,
      url: segmentUrl,
      stage: 'playback-segment',
    });
  }
  const contentRange = response.headers.get('content-range');
  if (response.status === 206 && contentRange && !/^bytes\s+0-/i.test(contentRange)) {
    await cancelBody(response);
    throw new EmbedTvError('A origem ignorou o início da faixa solicitada', {
      statusCode: 502,
      code: 'invalid_segment_range',
      url: segmentUrl,
      stage: 'playback-segment',
    });
  }
  const prefix = await readBoundedPrefix(response, 384, 5000);
  if (!isPlausibleMediaSegment(prefix)) {
    throw new EmbedTvError('O primeiro recurso do manifesto não contém bytes de mídia reconhecíveis', {
      statusCode: 502,
      code: 'invalid_media_segment',
      url: segmentUrl,
      stage: 'playback-segment',
      contentType: response.headers.get('content-type') || undefined,
    });
  }
  return {
    channelId: channel.id,
    segmentHost: new URL(segmentUrl).hostname,
    bytesRead: prefix.length,
    contentType: response.headers.get('content-type') || '',
    rangeStatus: response.status,
  };
}

async function loadFirstMediaPlaylist(client, resolution, loadManifest) {
  let manifest = await loadManifest(resolution);
  for (let depth = 0; depth < 3; depth += 1) {
    const variantUrl = getFirstVariantUrl(manifest.text, manifest.url);
    if (!variantUrl) return manifest;
    const variant = await client.fetchText(variantUrl, {
      retry: false,
      stage: 'manifest-variant',
      headers: resolution.headers,
    });
    if (!isHlsBody(variant.text, variant.contentType)) {
      throw new EmbedTvError('A playlist de qualidade não é um manifesto HLS válido', {
        statusCode: 502,
        code: 'invalid_variant_manifest',
        url: variantUrl,
        stage: 'manifest-variant',
        contentType: variant.contentType,
      });
    }
    manifest = { text: variant.text, url: variantUrl, contentType: variant.contentType };
  }
  if (getFirstVariantUrl(manifest.text, manifest.url)) {
    throw new EmbedTvError('Profundidade de playlists HLS excedida', {
      statusCode: 502,
      code: 'manifest_depth_exceeded',
      url: manifest.url,
      stage: 'manifest-variant',
    });
  }
  return manifest;
}

async function readBoundedPrefix(response, maxBytes, timeoutMs) {
  if (!response.body?.getReader) {
    await cancelBody(response);
    throw new EmbedTvError('A origem não forneceu um corpo de segmento legível', {
      statusCode: 502,
      code: 'empty_media_segment',
      stage: 'playback-segment',
    });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let completed = false;
  const deadline = Date.now() + timeoutMs;
  try {
    while (total < maxBytes) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new EmbedTvError('Tempo limite lendo o primeiro segmento', {
        statusCode: 504,
        code: 'timeout',
        stage: 'playback-segment',
      });
      let timer;
      const next = await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new EmbedTvError('Tempo limite lendo o primeiro segmento', {
            statusCode: 504,
            code: 'timeout',
            stage: 'playback-segment',
          })), remainingMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = Buffer.from(next.value);
      const limited = chunk.subarray(0, maxBytes - total);
      chunks.push(limited);
      total += limited.length;
      if (limited.length < chunk.length) break;
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function cancelBody(response) {
  const cancel = response?.body?.cancel?.();
  if (cancel) await cancel.catch(() => {});
}

export function toPublicPlaybackError(error) {
  return {
    code: error?.code || 'playback_failed',
    statusCode: error?.statusCode,
    message: `${error?.message || 'Falha ao validar o fluxo de mídia'}`.slice(0, 220),
    stage: error?.stage,
  };
}
