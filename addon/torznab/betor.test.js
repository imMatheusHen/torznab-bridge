import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

test('reuses one BeTor season page across episode searches', async () => {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(buildSeasonHtml());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    process.env.TORZNAB_BETOR_URL = `http://127.0.0.1:${address.port}`;
    process.env.TORZNAB_BETOR_RETRY_MAX_ATTEMPTS = '1';
    process.env.TORZNAB_BETOR_SEARCH_CACHE_TTL_MS = '60000';

    const { searchBetorReleaseRows } = await import(`./betor.js?test=${Date.now()}`);
    const baseOptions = {
      types: ['series'],
      imdbId: 'tt2861424',
      query: 'Rick and Morty',
      season: 9,
      limit: 100,
    };

    const episodeOne = await searchBetorReleaseRows({ ...baseOptions, episode: 1 });
    const episodeTwo = await searchBetorReleaseRows({ ...baseOptions, episode: 2 });
    const repeatedEpisodeTwo = await searchBetorReleaseRows({ ...baseOptions, episode: 2 });

    assert.equal(requestCount, 1);
    assert.equal(episodeOne.length, 1);
    assert.equal(episodeTwo.length, 1);
    assert.equal(repeatedEpisodeTwo.length, 1);
    assert.equal(episodeOne[0].provider, 'Comando Torrents');
    assert.equal(episodeOne[0].imdbEpisode, 1);
    assert.equal(episodeTwo[0].imdbEpisode, 2);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

function buildSeasonHtml() {
  return `
    <div class="item" data-item data-item-type="tv" data-item-imdb-id="tt2861424"
      data-torrent data-torrent-name="Rick.and.Morty.S09E01.1080p.WEB-DL.DUAL"
      data-torrent-magnet-uri="magnet:?xt=urn:btih:1111111111111111111111111111111111111111"
      data-torrent-files="Rick.and.Morty.S09E01.1080p.WEB-DL.DUAL.mkv"
      data-torrent-size="1000" data-torrent-num-seeds="10">
      <div class="top"><a class="provider">Comando Torrents</a></div>
      <div class="details"><div class="title">Rick and Morty</div></div>
    </div>
    <div class="item" data-item data-item-type="tv" data-item-imdb-id="tt2861424"
      data-torrent data-torrent-name="Rick.and.Morty.S09E02.1080p.WEB-DL.DUAL"
      data-torrent-magnet-uri="magnet:?xt=urn:btih:2222222222222222222222222222222222222222"
      data-torrent-files="Rick.and.Morty.S09E02.1080p.WEB-DL.DUAL.mkv"
      data-torrent-size="1000" data-torrent-num-seeds="8">
      <div class="top"><a class="provider">BluDV</a></div>
      <div class="details"><div class="title">Rick and Morty</div></div>
    </div>
  `;
}
