import assert from 'assert';
import { isMediaReleasePost } from '../src/services/newsService.js';

function runEngineTests() {
  console.log('--- Testing Expanded Engine Features ---');

  // Test 1: Media Release Filter
  const torrentTitle1 = 'From Old Country Bumpkin To Master Swordsman S02E05 1080p AMZN WEB-DL DUAL H264-VARYG';
  const torrentTitle2 = 'We Bare Bears The Movie 2020 1080p AMZN WEB-DL H264-CMRG';
  const realNews = '12 Words From Amazon CEO Andy Jassy That Should Have AI Investors Cheering';

  assert.strictEqual(isMediaReleasePost(torrentTitle1), true, 'Torrent title 1 filtered');
  assert.strictEqual(isMediaReleasePost(torrentTitle2), true, 'Torrent title 2 filtered');
  assert.strictEqual(isMediaReleasePost(realNews), false, 'Real financial news NOT filtered');
  console.log('✅ Media release filter test PASSED!');
}

runEngineTests();
