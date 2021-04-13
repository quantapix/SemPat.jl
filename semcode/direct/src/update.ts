import * as cp from 'child-process-promise';
import * as download from 'download';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import * as path from 'path';
import * as process from 'process';
import * as semver from 'semver';
async function our_download(url: string, destination: string) {
  const dest_path = path.join(process.cwd(), path.dirname(destination));
  try {
    await fs.access(path.join(dest_path, path.basename(destination)));
    await fs.unlink(path.join(dest_path, path.basename(destination)));
  } catch (err) {
    console.log(`Could not delete file '${path.join(dest_path, path.basename(destination))}'.`);
  }
  await download(url, dest_path);
  await fs.rename(path.join(dest_path, path.basename(url)), path.join(dest_path, path.basename(destination)));
  return;
}
import * as assert from 'assert';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as stream from 'stream';
import * as util from 'util';
import * as qv from 'vscode';
const pipeline = util.promisify(stream.pipeline);
const GITHUB_API_ENDPOINT_URL = 'https://api.github.com';
export async function fetchRelease(owner: string, repository: string, releaseTag: string): Promise<GithubRelease> {
  const apiEndpointPath = `/repos/${owner}/${repository}/releases/tags/${releaseTag}`;
  const requestUrl = GITHUB_API_ENDPOINT_URL + apiEndpointPath;
  console.debug('Issuing request for released artifacts metadata to', requestUrl);
  const response = await fetch(requestUrl, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!response.ok) {
    console.error('Error fetching artifact release info', {
      requestUrl,
      releaseTag,
      response: {
        headers: response.headers,
        status: response.status,
        body: await response.text(),
      },
    });
    throw new Error(`Got response ${response.status} when trying to fetch ` + `release info for ${releaseTag} release`);
  }
  const release: GithubRelease = await response.json();
  return release;
}
export interface GithubRelease {
  name: string;
  id: number;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}
export async function download(downloadUrl: string, destinationPath: string, progressTitle: string, { mode }: { mode?: number } = {}) {
  await qv.window.withProgress(
    {
      location: qv.ProgressLocation.Notification,
      cancellable: false,
      title: progressTitle,
    },
    async (progress, _cancellationToken) => {
      let lastPercentage = 0;
      await downloadFile(downloadUrl, destinationPath, mode, (readBytes, totalBytes) => {
        const newPercentage = (readBytes / totalBytes) * 100;
        progress.report({
          message: newPercentage.toFixed(0) + '%',
          increment: newPercentage - lastPercentage,
        });
        lastPercentage = newPercentage;
      });
    }
  );
}
async function downloadFile(url: string, destFilePath: fs.PathLike, mode: number | undefined, onProgress: (readBytes: number, totalBytes: number) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Error', res.status, 'while downloading file from', url);
    console.error({ body: await res.text(), headers: res.headers });
    throw new Error(`Got response ${res.status} when trying to download a file.`);
  }
  const totalBytes = Number(res.headers.get('content-length'));
  assert(!Number.isNaN(totalBytes), 'Sanity check of content-length protocol');
  console.debug('Downloading file of', totalBytes, 'bytes size from', url, 'to', destFilePath);
  let readBytes = 0;
  res.body.on('data', (chunk: Buffer) => {
    readBytes += chunk.length;
    onProgress(readBytes, totalBytes);
  });
  const destFileStream = fs.createWriteStream(destFilePath, { mode });
  await pipeline(res.body, destFileStream);
  return new Promise<void>((resolve) => {
    destFileStream.on('close', resolve);
    destFileStream.destroy();
  });
}
async function main() {
  const juliaPath = path.join(homedir(), 'AppData', 'Local', 'Julia-1.3.1', 'bin', 'julia.exe');
  await our_download('https://cdn.jsdelivr.net/npm/vega-lite@2', 'libs/vega-lite-2/vega-lite.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega-lite@3', 'libs/vega-lite-3/vega-lite.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega-lite@4', 'libs/vega-lite-4/vega-lite.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega@3', 'libs/vega-3/vega.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega@4', 'libs/vega-4/vega.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega@5', 'libs/vega-5/vega.min.js');
  await our_download('https://cdn.jsdelivr.net/npm/vega-embed@6', 'libs/vega-embed/vega-embed.min.js');
  await our_download('https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js', 'libs/webfont/webfont.js');
  await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/fontawesome.min.css', 'libs/fontawesome/fontawesome.min.css');
  await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/solid.min.css', 'libs/fontawesome/solid.min.css');
  await our_download('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.11.2/css/brands.min.css', 'libs/fontawesome/brands.min.css');
  for (const pkg of ['JSONRPC', 'CSTParser', 'LangServer', 'DocumentFormat', 'StaticLint', 'SymbolServer', 'DebugAdapter', 'ChromeProfileFormat']) {
    await cp.exec('git checkout master', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) });
    await cp.exec('git pull', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) });
  }
  for (const pkg of ['CodeTracking', 'FilePathsBase', 'JuliaInterpreter', 'LoweredCodeUtils', 'OrderedCollections', 'PackageCompiler', 'Revise', 'Tokenize', 'URIParser']) {
    const tags = await cp.exec('git tag', { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) });
    const newestTag = tags.stdout
      .split(/\r?\n/)
      .map((i) => {
        return { original: i, parsed: semver.valid(i) };
      })
      .filter((i) => i.parsed !== null)
      .sort((a, b) => semver.compare(b.parsed, a.parsed))[0];
    await cp.exec(`git checkout ${newestTag.original}`, { cwd: path.join(process.cwd(), `scripts/packages/${pkg}`) });
  }
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/development') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/languageserver') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/environments/sysimagecompile') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/debugadapter') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/vscodedebugger') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/vscodeserver') });
  await cp.exec(`${juliaPath} --project=. -e "using Pkg; Pkg.resolve()"`, { cwd: path.join(process.cwd(), 'scripts/testenvironments/chromeprofileformat') });
  await cp.exec('npm update', { cwd: process.cwd() });
}
main();
